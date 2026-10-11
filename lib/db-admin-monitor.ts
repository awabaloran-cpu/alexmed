// 📊 What the system is doing right now, for the admin's monitoring page
// (app/admin/monitor, lib/trpc/adminMonitorRouter.ts — adminProcedure).
//
// Numbers and short reasons only, read from what the pipelines already
// store: no file's text, no storage key, no student's name. The only
// identifiers that leave this module are a stuck file's id, its file name
// and how long it has stood still — what an admin needs to find it.
//
// "Stuck" is decided here once, the same way for every list:
//   - a file still being read (status "extracting") that nothing has
//     touched for STUCK_MINUTES;
//   - a question file whose questions are waiting for an explanation while
//     none is being written and no page has moved for STUCK_MINUTES.
// The AI gateway's spend is NOT here: it is not stored anywhere in the
// database (only in the server's logs), and nothing is shown that was not
// measured.
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { WINDOW_AHEAD, WINDOW_FIRST_QUESTIONS } from "./question-file-window";

export const STUCK_MINUTES = 20;
const REASON_MAX = 160;
const LIST_LIMIT = 15;

// A long question file is explained as it is studied
// (lib/question-file-window.ts): past its first questions, a question
// waits ON PURPOSE until a student gets near it. Counting those as "stuck"
// would cry wolf over every long file (seen on the first live reading: two
// healthy banks listed as stopped for 54 hours). So a waiting question is
// "owed now" only when the file is short enough to be explained whole, is
// a doctor's set (always whole), or the question is among the first ones.
// The stretch a student has reached is not counted — a stall there shows
// one answer later than it could.
const WHOLE_FILE_MAX = WINDOW_FIRST_QUESTIONS + WINDOW_AHEAD;
const owedNow = sql`(
  q."orderIndex" < ${WINDOW_FIRST_QUESTIONS}
  or (select count(*) from "extracted_questions" x
        where x."bookId" = q."bookId") <= ${WHOLE_FILE_MAX}
  or exists (select 1 from "question_sets" s where s."bookId" = q."bookId")
)`;

// What an admin wrote on work they stopped by hand (a runaway file): not a
// failure of the system, and counted apart.
const STOPPED_BY_ADMIN = "stopped_by_admin";

const cut = (text: string | null | undefined) =>
  !text
    ? ""
    : text.length > REASON_MAX
      ? `${text.slice(0, REASON_MAX)}…`
      : text;

export type MonitorReason = { reason: string; count: number };
export type StuckFile = {
  id: string;
  fileName: string;
  kind: "book" | "question_file";
  stage: "reading" | "explaining";
  minutes: number;
  waiting: number;
};

export type AdminMonitor = {
  at: Date;
  files: {
    readingNow: number;
    stuckReading: number;
    failed24h: number;
    done24h: number;
    // Upload to "read", for files finished in the last 24 hours. Null when
    // none finished.
    avgReadMinutes: number | null;
    failureRate24h: number | null;
  };
  chapters: { waiting: number; analyzing: number; failed: number };
  questions: {
    // Owed an explanation now.
    waiting: number;
    // Waiting on purpose, until a student gets near them (long files).
    deferred: number;
    writing: number;
    // Used up every attempt, in files uploaded in the last 7 days.
    failed7d: number;
    // Stopped by an admin's own hand, in the same 7 days — not failures.
    stoppedByAdmin7d: number;
    stalledFiles: number;
  };
  sets: {
    drafts: number;
    draftsPreparing: number;
    needsReview: number;
    published: number;
  };
  rooms: {
    active: number;
    present: number;
    ended24h: number;
    // Closed by the sweep because nobody was left, not by its leader.
    endedEmpty24h: number;
  };
  reasons: {
    files: MonitorReason[];
    questions: MonitorReason[];
    pages: MonitorReason[];
  };
  stuck: StuckFile[];
};

const EMPTY: AdminMonitor = {
  at: new Date(0),
  files: {
    readingNow: 0,
    stuckReading: 0,
    failed24h: 0,
    done24h: 0,
    avgReadMinutes: null,
    failureRate24h: null,
  },
  chapters: { waiting: 0, analyzing: 0, failed: 0 },
  questions: {
    waiting: 0,
    deferred: 0,
    writing: 0,
    failed7d: 0,
    stoppedByAdmin7d: 0,
    stalledFiles: 0,
  },
  sets: { drafts: 0, draftsPreparing: 0, needsReview: 0, published: 0 },
  rooms: { active: 0, present: 0, ended24h: 0, endedEmpty24h: 0 },
  reasons: { files: [], questions: [], pages: [] },
  stuck: [],
};

// A table that is not there yet (a feature whose migration has not been
// applied) counts as nothing, not as a broken page.
async function safely<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth++) {
      if ((current as { code?: string }).code === "42P01") return fallback;
      current = (current as { cause?: unknown }).cause;
    }
    throw error;
  }
}

const n = (value: unknown) => Number(value ?? 0);

// A question file whose explanations have stopped: questions still owed,
// none being written, and no page of it touched for a while.
const stalledQuestionFile = sql`
  b."sourceType" = 'question_file' and b."status" = 'complete'
  and exists (
    select 1 from "extracted_questions" q
    where q."bookId" = b."id" and q."aiStatus" = 'pending'
      and q."reviewStatus" is distinct from 'needs_review'
      and ${owedNow}
  )
  and not exists (
    select 1 from "extracted_questions" q
    where q."bookId" = b."id" and q."aiStatus" = 'processing'
  )
  and not exists (
    select 1 from "question_file_pages" p
    where p."bookId" = b."id"
      and p."updatedAt" > now() - make_interval(mins => ${STUCK_MINUTES})
  )
  and b."updatedAt" < now() - make_interval(mins => ${STUCK_MINUTES})
`;

export async function getAdminMonitor(): Promise<AdminMonitor> {
  const db = getDb();
  if (!db) return { ...EMPTY, at: new Date() };

  const [files] = await db.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where "status" = 'extracting')::int as reading_now,
      count(*) filter (
        where "status" = 'extracting'
          and "updatedAt" < now() - make_interval(mins => ${STUCK_MINUTES})
      )::int as stuck_reading,
      count(*) filter (
        where "status" = 'failed' and "updatedAt" > now() - interval '24 hours'
      )::int as failed_24h,
      count(*) filter (
        where "status" in ('complete', 'partial_failed', 'processing')
          and "createdAt" > now() - interval '24 hours'
      )::int as done_24h,
      round(avg(extract(epoch from ("updatedAt" - "createdAt")) / 60.0) filter (
        where "status" = 'complete' and "createdAt" > now() - interval '24 hours'
          and "sourceType" = 'question_file'
      ))::int as avg_read_minutes
    from "books"
  `);

  const [chapters] = await db.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where "status" in ('pending', 'retrying'))::int as waiting,
      count(*) filter (where "status" in ('analyzing', 'processing'))::int as analyzing,
      count(*) filter (where "status" = 'failed')::int as failed
    from "book_chapters"
  `);

  // Every question once, against its file's size (worked out once per
  // file, not once per question).
  const [questions] = await db.execute<Record<string, unknown>>(sql`
    with sizes as (
      select x."bookId", count(*) as total,
        exists (
          select 1 from "question_sets" s where s."bookId" = x."bookId"
        ) as whole
      from "extracted_questions" x
      group by x."bookId"
    ),
    marked as (
      select q."aiStatus", q."aiAttemptCount", q."aiError", q."createdAt",
        (q."orderIndex" < ${WINDOW_FIRST_QUESTIONS}
          or t.total <= ${WHOLE_FILE_MAX} or t.whole) as owed
      from "extracted_questions" q
      join sizes t on t."bookId" = q."bookId"
      where q."reviewStatus" is distinct from 'needs_review'
    )
    select
      count(*) filter (where "aiStatus" = 'pending' and owed)::int as waiting,
      count(*) filter (where "aiStatus" = 'pending' and not owed)::int as deferred,
      count(*) filter (where "aiStatus" = 'processing')::int as writing,
      count(*) filter (
        where "aiStatus" = 'failed' and "aiAttemptCount" >= 3
          and "aiError" is distinct from ${STOPPED_BY_ADMIN}
          and "createdAt" > now() - interval '7 days'
      )::int as failed_7d,
      count(*) filter (
        where "aiStatus" = 'failed' and "aiError" = ${STOPPED_BY_ADMIN}
          and "createdAt" > now() - interval '7 days'
      )::int as stopped_7d
    from marked
  `);
  const [stalled] = await db.execute<Record<string, unknown>>(sql`
    select count(*)::int as files from "books" b where ${stalledQuestionFile}
  `);

  const sets = await safely(
    async () =>
      (
        await db.execute<Record<string, unknown>>(sql`
          select
            count(*) filter (where s."status" = 'draft')::int as drafts,
            count(*) filter (where s."status" = 'published')::int as published,
            count(*) filter (
              where s."status" = 'draft' and (
                b."status" = 'extracting'
                or exists (
                  select 1 from "extracted_questions" q
                  where q."bookId" = s."bookId"
                    and q."aiStatus" in ('pending', 'processing')
                )
              )
            )::int as drafts_preparing,
            coalesce(sum((
              select count(*) from "extracted_questions" q
              where q."bookId" = s."bookId" and q."reviewStatus" = 'needs_review'
            )) filter (where s."status" = 'draft'), 0)::int as needs_review
          from "question_sets" s
          join "books" b on b."id" = s."bookId"
        `)
      )[0],
    {} as Record<string, unknown>
  );

  const rooms = await safely(
    async () =>
      (
        await db.execute<Record<string, unknown>>(sql`
          select
            (select count(*)::int from "study_rooms" where "status" = 'active') as active,
            (select count(*)::int from "study_room_members" m
              join "study_rooms" r on r."id" = m."roomId" and r."status" = 'active'
              where m."state" = 'joined') as present,
            (select count(*)::int from "study_room_events"
              where "type" in ('end', 'empty_end', 'admin_end')
                and "createdAt" > now() - interval '24 hours') as ended_24h,
            (select count(*)::int from "study_room_events"
              where "type" = 'empty_end'
                and "createdAt" > now() - interval '24 hours') as ended_empty_24h
        `)
      )[0],
    {} as Record<string, unknown>
  );

  const reasons = async (table: ReturnType<typeof sql>) =>
    (
      await db.execute<{ reason: string | null; count: number }>(sql`
        select left(reason, ${REASON_MAX + 1}) as reason, count(*)::int as count
        from (${table}) failures
        where reason is not null and reason <> ''
          and reason <> ${STOPPED_BY_ADMIN}
        group by 1 order by 2 desc limit 5
      `)
    ).map(row => ({ reason: cut(row.reason), count: n(row.count) }));

  const fileReasons = await reasons(sql`
    select "extractionError" as reason from "books"
    where "status" = 'failed' and "updatedAt" > now() - interval '7 days'
  `);
  const questionReasons = await reasons(sql`
    select "aiError" as reason from "extracted_questions"
    where "aiStatus" = 'failed' and "createdAt" > now() - interval '7 days'
  `);
  const pageReasons = await reasons(sql`
    select "errorMessage" as reason from "question_file_pages"
    where "status" = 'failed' and "updatedAt" > now() - interval '7 days'
  `);

  const stuckReading = await db.execute<Record<string, unknown>>(sql`
    select b."id", b."fileName", b."sourceType" as kind,
      floor(extract(epoch from (now() - b."updatedAt")) / 60)::int as minutes
    from "books" b
    where b."status" = 'extracting'
      and b."updatedAt" < now() - make_interval(mins => ${STUCK_MINUTES})
    order by b."updatedAt" asc
    limit ${LIST_LIMIT}
  `);
  const stuckExplaining = await db.execute<Record<string, unknown>>(sql`
    select b."id", b."fileName",
      floor(extract(epoch from (now() - b."updatedAt")) / 60)::int as minutes,
      (select count(*)::int from "extracted_questions" q
        where q."bookId" = b."id" and q."aiStatus" = 'pending'
          and ${owedNow}) as waiting
    from "books" b
    where ${stalledQuestionFile}
    order by b."updatedAt" asc
    limit ${LIST_LIMIT}
  `);

  const failed24h = n(files?.failed_24h);
  const done24h = n(files?.done_24h);
  return {
    at: new Date(),
    files: {
      readingNow: n(files?.reading_now),
      stuckReading: n(files?.stuck_reading),
      failed24h,
      done24h,
      avgReadMinutes:
        files?.avg_read_minutes === null ||
        files?.avg_read_minutes === undefined
          ? null
          : n(files.avg_read_minutes),
      failureRate24h:
        failed24h + done24h > 0 ? failed24h / (failed24h + done24h) : null,
    },
    chapters: {
      waiting: n(chapters?.waiting),
      analyzing: n(chapters?.analyzing),
      failed: n(chapters?.failed),
    },
    questions: {
      waiting: n(questions?.waiting),
      deferred: n(questions?.deferred),
      writing: n(questions?.writing),
      failed7d: n(questions?.failed_7d),
      stoppedByAdmin7d: n(questions?.stopped_7d),
      stalledFiles: n(stalled?.files),
    },
    sets: {
      drafts: n(sets.drafts),
      draftsPreparing: n(sets.drafts_preparing),
      needsReview: n(sets.needs_review),
      published: n(sets.published),
    },
    rooms: {
      active: n(rooms.active),
      present: n(rooms.present),
      ended24h: n(rooms.ended_24h),
      endedEmpty24h: n(rooms.ended_empty_24h),
    },
    reasons: {
      files: fileReasons,
      questions: questionReasons,
      pages: pageReasons,
    },
    stuck: [
      ...stuckReading.map(row => ({
        id: String(row.id),
        fileName: String(row.fileName ?? ""),
        kind:
          row.kind === "question_file"
            ? ("question_file" as const)
            : ("book" as const),
        stage: "reading" as const,
        minutes: n(row.minutes),
        waiting: 0,
      })),
      ...stuckExplaining.map(row => ({
        id: String(row.id),
        fileName: String(row.fileName ?? ""),
        kind: "question_file" as const,
        stage: "explaining" as const,
        minutes: n(row.minutes),
        waiting: n(row.waiting),
      })),
    ],
  };
}
