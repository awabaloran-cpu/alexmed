import { beforeAll, describe, expect, it, vi } from "vitest";
import { bookCards, bookChapters } from "../drizzle/schema";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "./test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));
vi.mock("./db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import { getUpcomingReviewForecastForUser } from "./db-books";

const USER = "11111111-1111-4111-8111-111111111111";
const BOOK = "33333333-3333-4333-8333-333333333333";

let test: TestDb;
// Tomorrow 22:30 UTC: the next day already, for a student at UTC+3.
const due = new Date();
due.setUTCDate(due.getUTCDate() + 1);
due.setUTCHours(22, 30, 0, 0);
const utcDay = due.toISOString().slice(0, 10);
const nextDay = new Date(due.getTime() + 3 * 3_600_000)
  .toISOString()
  .slice(0, 10);

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  await insertUser(test.client, { id: USER });
  await insertQuestionFile(test.client, {
    id: BOOK,
    userId: USER,
    fileKey: "uploads/u/book.pdf",
    questions: 0,
  });
  const [chapter] = await test.db
    .insert(bookChapters)
    .values({
      bookId: BOOK,
      orderIndex: 0,
      title: "Chapter",
      startPage: 1,
      endPage: 2,
    })
    .returning({ id: bookChapters.id });
  await test.db.insert(bookCards).values(
    [1, 2].map(n => ({
      chapterId: chapter.id,
      userId: USER,
      questionAr: `س${n}`,
      questionEn: `Q${n}`,
      answerAr: `ج${n}`,
      answerEn: `A${n}`,
      sourcePage: 1,
      dueAt: due,
    }))
  );
}, 60_000);

describe("the week of reviews ahead", () => {
  it("without an offset answers as it always did: UTC days", async () => {
    const rows = await getUpcomingReviewForecastForUser(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(new Date(rows[0].day).toISOString().slice(0, 10)).toBe(utcDay);
  });

  it("with the student's offset counts a late-evening card on their own day", async () => {
    expect(await getUpcomingReviewForecastForUser(USER, 7, 180)).toEqual([
      { day: nextDay, count: 2 },
    ]);
    expect(await getUpcomingReviewForecastForUser(USER, 7, 0)).toEqual([
      { day: utcDay, count: 2 },
    ]);
    // West of UTC the card stays on the same day.
    expect(await getUpcomingReviewForecastForUser(USER, 7, -300)).toEqual([
      { day: utcDay, count: 2 },
    ]);
  });
});
