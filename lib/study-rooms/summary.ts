// 🧾 What a sitting in a room came to, and the rooms a student has been in.
//
// For anyone who is or was a member (never someone who was banned from it,
// never an outsider): how long it lasted, who took part, the file and the
// page it stopped on, the pages that were highlighted, and each finished
// quiz with the student's own result. A read of what the room already
// stored — nothing here is estimated, and nothing is written.
//
// The file itself is NOT opened from here: a member could read it only
// while in the room (lib/study-rooms/live.ts). Its name and the page are
// shown; only its owner gets a way back into it.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  books,
  studyRoomMarks,
  studyRoomMembers,
  studyRoomMessages,
  studyRoomQuizAnswers,
  studyRoomQuizzes,
  studyRooms,
  studySubjects,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { RoomError } from "./errors";
import type { Viewer } from "./profile";

// Was in the room at some point, and was not thrown out for good.
const TOOK_PART = ["joined", "left"];

const minutesBetween = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

export async function roomSummary(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const [room] = await db
    .select()
    .from(studyRooms)
    .where(eq(studyRooms.id, roomId))
    .limit(1);
  const [membership] = room
    ? await db
        .select({
          state: studyRoomMembers.state,
          joinedAt: studyRoomMembers.joinedAt,
          leftAt: studyRoomMembers.leftAt,
        })
        .from(studyRoomMembers)
        .where(
          and(
            eq(studyRoomMembers.roomId, roomId),
            eq(studyRoomMembers.userId, viewer.userId)
          )
        )
        .limit(1)
    : [];
  if (!room || !membership || !TOOK_PART.includes(membership.state)) {
    throw new RoomError("not_available");
  }

  const ended = room.status !== "active";
  const until = room.endedAt ?? room.lastActiveAt;

  const participants = await db
    .select({ userId: studyRoomMembers.userId, name: users.name })
    .from(studyRoomMembers)
    .innerJoin(users, eq(users.id, studyRoomMembers.userId))
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        inArray(studyRoomMembers.state, TOOK_PART),
        // Neither of the two has blocked the other.
        sql`not exists (
          select 1 from "user_blocks" ub
          where (ub."blockerId" = ${viewer.userId} and ub."blockedId" = "study_room_members"."userId")
             or (ub."blockerId" = "study_room_members"."userId" and ub."blockedId" = ${viewer.userId})
        )`
      )
    )
    .orderBy(asc(studyRoomMembers.joinedAt))
    .limit(40);

  const [book] = room.bookId
    ? await db
        .select({
          id: books.id,
          fileName: books.fileName,
          pageCount: books.pageCount,
          userId: books.userId,
          sourceType: books.sourceType,
        })
        .from(books)
        .where(eq(books.id, room.bookId))
        .limit(1)
    : [];

  const markedPages = room.bookId
    ? await db
        .select({
          page: studyRoomMarks.pageNumber,
          marks: sql<number>`count(*)::int`,
        })
        .from(studyRoomMarks)
        .where(
          and(
            eq(studyRoomMarks.roomId, roomId),
            eq(studyRoomMarks.bookId, room.bookId),
            sql`${studyRoomMarks.deletedAt} is null`
          )
        )
        .groupBy(studyRoomMarks.pageNumber)
        .orderBy(asc(studyRoomMarks.pageNumber))
        .limit(60)
    : [];

  const [messages] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studyRoomMessages)
    .where(
      and(
        eq(studyRoomMessages.roomId, roomId),
        sql`${studyRoomMessages.deletedAt} is null`
      )
    );

  const finished = await db
    .select({
      id: studyRoomQuizzes.id,
      questionIds: studyRoomQuizzes.questionIds,
      finishedAt: studyRoomQuizzes.finishedAt,
    })
    .from(studyRoomQuizzes)
    .where(
      and(
        eq(studyRoomQuizzes.roomId, roomId),
        eq(studyRoomQuizzes.state, "finished")
      )
    )
    .orderBy(desc(studyRoomQuizzes.finishedAt))
    .limit(10);
  const scores = finished.length
    ? await db
        .select({
          quizId: studyRoomQuizAnswers.quizId,
          userId: studyRoomQuizAnswers.userId,
          points: sql<number>`sum(${studyRoomQuizAnswers.points})::int`,
          correct: sql<number>`count(*) filter (where ${studyRoomQuizAnswers.isCorrect})::int`,
        })
        .from(studyRoomQuizAnswers)
        .where(
          inArray(
            studyRoomQuizAnswers.quizId,
            finished.map(quiz => quiz.id)
          )
        )
        .groupBy(studyRoomQuizAnswers.quizId, studyRoomQuizAnswers.userId)
    : [];
  const quizzes = finished.map(quiz => {
    // The same order the quiz's own results use (lib/study-rooms/quiz.ts).
    const ranking = scores
      .filter(row => row.quizId === quiz.id)
      .map(row => ({
        userId: row.userId,
        points: Number(row.points),
        correct: Number(row.correct),
      }))
      .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
    const mine = ranking.findIndex(row => row.userId === viewer.userId);
    return {
      id: quiz.id,
      total: quiz.questionIds.length,
      finishedAt: quiz.finishedAt,
      players: ranking.length,
      me:
        mine >= 0
          ? {
              rank: mine + 1,
              correct: ranking[mine].correct,
              points: ranking[mine].points,
            }
          : null,
    };
  });

  return {
    room: {
      id: room.id,
      title: room.title,
      ended,
      startedAt: room.createdAt,
      endedAt: ended ? until : null,
    },
    minutes: minutesBetween(room.createdAt, until),
    // The student's own time in it (their last stay).
    myMinutes: minutesBetween(
      membership.joinedAt,
      membership.leftAt ?? (ended ? until : new Date())
    ),
    participants: participants.map(person => ({
      userId: person.userId,
      name: person.name,
    })),
    file: book
      ? {
          name: book.fileName,
          pageCount: book.pageCount,
          lastPage: Math.min(
            Math.max(1, room.sharedPage),
            Math.max(1, book.pageCount)
          ),
          // Only the owner can open the file again, in its own place.
          mine: book.userId === viewer.userId,
          bookId: book.userId === viewer.userId ? book.id : null,
          kind:
            book.sourceType === "question_file"
              ? ("questions" as const)
              : ("book" as const),
        }
      : null,
    markedPages: markedPages.map(row => ({
      page: row.page,
      marks: Number(row.marks),
    })),
    messages: Number(messages?.n ?? 0),
    quizzes,
  };
}

// The rooms a student has been in that are over for them: ended, or left.
export async function roomHistory(viewer: Viewer) {
  const db = requireDb();
  const rows = await db
    .select({
      id: studyRooms.id,
      title: studyRooms.title,
      status: studyRooms.status,
      createdAt: studyRooms.createdAt,
      endedAt: studyRooms.endedAt,
      lastActiveAt: studyRooms.lastActiveAt,
      subjectEn: studySubjects.nameEn,
      subjectAr: studySubjects.nameAr,
      subjectText: studyRooms.subjectText,
      leftAt: studyRoomMembers.leftAt,
      people: sql<number>`(
        select count(*)::int from "study_room_members" m
        where m."roomId" = "study_rooms"."id" and m."state" in ('joined', 'left')
      )`,
    })
    .from(studyRoomMembers)
    .innerJoin(studyRooms, eq(studyRooms.id, studyRoomMembers.roomId))
    .leftJoin(studySubjects, eq(studySubjects.id, studyRooms.subjectId))
    .where(
      and(
        eq(studyRoomMembers.userId, viewer.userId),
        inArray(studyRoomMembers.state, TOOK_PART),
        sql`("study_rooms"."status" <> 'active' or "study_room_members"."state" = 'left')`
      )
    )
    .orderBy(
      desc(
        sql`coalesce("study_rooms"."endedAt", "study_room_members"."leftAt", "study_rooms"."lastActiveAt")`
      )
    )
    .limit(20);
  return rows.map(row => {
    const until = row.endedAt ?? row.lastActiveAt;
    return {
      id: row.id,
      title: row.title,
      ended: row.status !== "active",
      subject: row.subjectEn ?? row.subjectText ?? null,
      subjectAr: row.subjectAr ?? null,
      when: row.endedAt ?? row.leftAt ?? row.lastActiveAt,
      minutes: minutesBetween(row.createdAt, until),
      people: Number(row.people),
    };
  });
}
