// Real-Postgres integration test for 📤 Study Pack sharing — the full
// request lifecycle, the authorization matrix, progress independence,
// revoke/remove and file access, through the real tRPC routers. AI and the
// queue are mocked + spied to prove sharing never costs an AI call.
// Skipped unless LIVE_DB=1. Uses throwaway users
// (sharing-qa+<time>-<x>@example.invalid) and deletes them at the end, which
// cascades to their books, shares, notifications and progress.
//
//   LIVE_DB=1 npx vitest run lib/sharing.integration.test.ts
import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./llm", async importOriginal => ({
  ...(await importOriginal<typeof import("./llm")>()),
  invokeLLM: vi.fn(),
}));
vi.mock("./queue/client", () => ({ publishMessage: vi.fn() }));

const live = process.env.LIVE_DB === "1";
if (live) loadEnv();

describe.skipIf(!live)(
  "Study Pack sharing — real database",
  { timeout: 60_000 },
  () => {
    const stamp = Date.now();
    const ids = { a: "", b: "", c: "" };
    const names = {
      a: `qa_owner_${stamp}`,
      b: `qa_recipient_${stamp}`,
      c: `qa_other_${stamp}`,
    };
    let bookId = "";
    let chapterId = "";
    let cardIds: string[] = [];
    let mcqId = "";
    let efCardId = "";
    const fileKey = `book-pdfs/sharing-qa-${stamp}.pdf`;

    let schema: typeof import("../drizzle/schema");
    let requireDb: typeof import("./db").requireDb;
    let orm: typeof import("drizzle-orm");
    let routers: {
      books: typeof import("./trpc/booksRouter").booksRouter;
      sharing: typeof import("./trpc/sharingRouter").sharingRouter;
      examFocus: typeof import("./trpc/examFocusRouter").examFocusRouter;
    };
    let isFileKeyAccessibleToUser: typeof import("./db-file-access").isFileKeyAccessibleToUser;
    let invokeLLM: ReturnType<typeof vi.fn>;
    let publishMessage: ReturnType<typeof vi.fn>;

    const as = (who: keyof typeof ids) => {
      const ctx = { user: { id: ids[who], role: "user" } } as never;
      return {
        books: routers.books.createCaller(ctx),
        sharing: routers.sharing.createCaller(ctx),
        examFocus: routers.examFocus.createCaller(ctx),
      };
    };

    beforeAll(async () => {
      schema = await import("../drizzle/schema");
      ({ requireDb } = await import("./db"));
      orm = await import("drizzle-orm");
      routers = {
        books: (await import("./trpc/booksRouter")).booksRouter,
        sharing: (await import("./trpc/sharingRouter")).sharingRouter,
        examFocus: (await import("./trpc/examFocusRouter")).examFocusRouter,
      };
      ({ isFileKeyAccessibleToUser } = await import("./db-file-access"));
      invokeLLM = (await import("./llm")).invokeLLM as never;
      publishMessage = (await import("./queue/client")).publishMessage as never;

      const db = requireDb();
      for (const key of ["a", "b", "c"] as const) {
        const [user] = await db
          .insert(schema.users)
          .values({
            email: `sharing-qa+${stamp}-${key}@example.invalid`,
            name: `Sharing QA ${key.toUpperCase()}`,
            username: names[key],
          })
          .returning({ id: schema.users.id });
        ids[key] = user.id;
      }
      // Files go to colleagues only (lib/colleagues.ts): A knows B and C.
      await db.insert(schema.studyConnections).values(
        (["b", "c"] as const).map(key => ({
          requesterId: ids.a,
          addresseeId: ids[key],
          status: "accepted",
          respondedAt: new Date(),
        }))
      );
      const [book] = await db
        .insert(schema.books)
        .values({
          userId: ids.a,
          fileName: "Sharing QA Anatomy.pdf",
          fileKey,
          pageCount: 2,
          status: "complete",
        })
        .returning({ id: schema.books.id });
      bookId = book.id;
      const [chapter] = await db
        .insert(schema.bookChapters)
        .values({
          bookId,
          orderIndex: 0,
          title: "Chapter 1",
          startPage: 1,
          endPage: 2,
          status: "complete",
          explanationEn: "The heart pumps blood.",
        })
        .returning({ id: schema.bookChapters.id });
      chapterId = chapter.id;
      const cards = await db
        .insert(schema.bookCards)
        .values(
          [1, 2].map(n => ({
            chapterId,
            userId: ids.a,
            questionAr: `س ${n}`,
            questionEn: `Q ${n}`,
            answerAr: `ج ${n}`,
            answerEn: `A ${n}`,
            sourcePage: n,
            // The owner's own, advanced progress — must never leak.
            reviewCount: 5,
            intervalDays: 20,
            lastRating: "easy" as const,
          }))
        )
        .returning({ id: schema.bookCards.id });
      cardIds = cards.map(card => card.id);
      const [mcq] = await db
        .insert(schema.bookMcqs)
        .values({
          chapterId,
          questionEn: "Which chamber pumps to the aorta?",
          choices: ["RA", "RV", "LA", "LV"],
          correctIndex: 3,
          explanationEn: "The left ventricle.",
          sourcePage: 1,
        })
        .returning({ id: schema.bookMcqs.id });
      mcqId = mcq.id;
      const [deck] = await db
        .insert(schema.examFocusDecks)
        .values({
          userId: ids.a,
          bookId,
          status: "complete",
          totalCards: 1,
        })
        .returning({ id: schema.examFocusDecks.id });
      const [efCard] = await db
        .insert(schema.examFocusCards)
        .values({
          deckId: deck.id,
          orderIndex: 0,
          category: "definition",
          title: "Cardiac output",
          points: ["HR × SV"],
          sourcePages: [1],
          unitIndex: 0,
          searchText: "cardiac output",
        })
        .returning({ id: schema.examFocusCards.id });
      efCardId = efCard.id;
    });

    // Removes this run's QA users (and any left over by an interrupted run)
    // — matched by the reserved example.invalid address only.
    afterAll(async () => {
      if (!requireDb) return;
      await requireDb()
        .delete(schema.users)
        .where(orm.like(schema.users.email, "sharing-qa+%@example.invalid"));
    }, 60_000);

    it("search finds students by username/name — never by email, never self", async () => {
      const byUsername = await as("b").sharing.searchUsers({
        query: `qa_owner_${stamp}`,
      });
      expect(byUsername.items.map(u => u.id)).toEqual([ids.a]);
      expect(Object.keys(byUsername.items[0]).sort()).toEqual(
        ["id", "image", "name", "username"].sort()
      );
      const byName = await as("a").sharing.searchUsers({
        query: "Sharing QA",
      });
      expect(byName.items.map(u => u.id)).not.toContain(ids.a);
      const byEmail = await as("b").sharing.searchUsers({
        query: `sharing-qa+${stamp}-a@example.invalid`,
      });
      expect(byEmail.items).toEqual([]);
    });

    it("before any share, B and C can't read A's pack", async () => {
      for (const who of ["b", "c"] as const) {
        await expect(
          as(who).books.getStudyContent({ bookId })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(await isFileKeyAccessibleToUser(ids.b, fileKey)).toBe(false);
    });

    let shareId = "";
    it("A sends a request; duplicates and self-share are refused", async () => {
      await expect(
        as("a").sharing.sendRequest({ bookId, recipientId: ids.a })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const sent = await as("a").sharing.sendRequest({
        bookId,
        recipientId: ids.b,
      });
      shareId = sent.shareId;
      await expect(
        as("a").sharing.sendRequest({ bookId, recipientId: ids.b })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // A non-owner can't share someone else's file.
      await expect(
        as("c").sharing.sendRequest({ bookId, recipientId: ids.b })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Pending grants nothing.
      await expect(
        as("b").books.getStudyContent({ bookId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("B is notified and sees the request with its contents", async () => {
      const incoming = await as("b").sharing.incoming();
      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toMatchObject({
        shareId,
        bookTitle: "Sharing QA Anatomy.pdf",
        ownerUsername: names.a,
        contents: { flashcards: 2, questions: 1, examFocus: 1 },
      });
      const summary = await as("b").sharing.homeSummary();
      expect(summary.pending).toBe(1);
      const notes = await as("b").sharing.notifications();
      expect(notes[0]).toMatchObject({ type: "share_request" });
      // C can't answer B's request.
      await expect(
        as("c").sharing.respond({ shareId, decision: "accept" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("B accepts: A is notified, B reads every viewer, 0 AI calls", async () => {
      invokeLLM.mockClear();
      publishMessage.mockClear();
      await as("b").sharing.respond({ shareId, decision: "accept" });
      const aNotes = await as("a").sharing.notifications();
      expect(aNotes[0]).toMatchObject({ type: "share_accepted" });
      await expect(
        as("a").sharing.sendRequest({ bookId, recipientId: ids.b })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("لديه وصول"),
      });

      const b = as("b");
      const got = await b.books.get({ id: bookId });
      expect(got.access.role).toBe("shared");
      expect(got.book.subjectId).toBeNull();
      const content = await b.books.getStudyContent({ bookId });
      expect(content.cards).toHaveLength(2);
      // The owner's review state is replaced by B's own (fresh) state.
      for (const card of content.cards) {
        expect(card.reviewCount).toBe(0);
        expect(card.lastRating).toBeNull();
        expect(card.userId).toBe(ids.b);
      }
      await b.books.getChapter({ id: chapterId });
      await b.books.getMindMap({ id: bookId });
      await b.books.listPages({ bookId });
      await b.books.getCoverageDetail({ bookId });
      const ef = await b.examFocus.get({ bookId });
      expect(ef?.deck.totalCards).toBe(1);
      const efCards = await b.examFocus.cards({ bookId });
      expect(efCards.items).toHaveLength(1);
      expect(await isFileKeyAccessibleToUser(ids.b, fileKey)).toBe(true);
      expect(await isFileKeyAccessibleToUser(ids.c, fileKey)).toBe(false);

      expect(invokeLLM).not.toHaveBeenCalled();
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("B's progress, answers and bookmarks stay B's — A's are untouched", async () => {
      const b = as("b");
      await b.books.rateCard({ cardId: cardIds[0], rating: "good" });
      await b.books.submitMcqAttempt({ mcqId, selectedIndex: 3 });
      await b.examFocus.setBookmark({ cardId: efCardId, bookmarked: true });

      const mine = await b.books.getStudyContent({ bookId });
      expect(mine.cards.find(c => c.id === cardIds[0])?.reviewCount).toBe(1);
      const owners = await as("a").books.getStudyContent({ bookId });
      for (const card of owners.cards) expect(card.reviewCount).toBe(5);

      const attempts = await requireDb()
        .select()
        .from(schema.bookMcqAttempts)
        .where(orm.eq(schema.bookMcqAttempts.mcqId, mcqId));
      expect(attempts.map(a => a.userId)).toEqual([ids.b]);

      expect((await b.examFocus.get({ bookId }))?.bookmarkedCount).toBe(1);
      expect((await as("a").examFocus.get({ bookId }))?.bookmarkedCount).toBe(
        0
      );
      const bSaved = await b.examFocus.cards({ bookId, bookmarkedOnly: true });
      const aSaved = await as("a").examFocus.cards({
        bookId,
        bookmarkedOnly: true,
      });
      expect(bSaved.total).toBe(1);
      expect(aSaved.total).toBe(0);
    });

    it("B can't generate, regenerate or reprocess anything", async () => {
      invokeLLM.mockClear();
      publishMessage.mockClear();
      const b = as("b");
      for (const run of [
        () => b.books.generateChapterFlashcards({ chapterId }),
        () => b.books.generateChapterMcqs({ chapterId }),
        () => b.books.validateChapterMcqs({ chapterId }),
        () => b.books.startChapterAnalysis({ bookId }),
        () => b.examFocus.regenerate({ bookId }),
        () => b.examFocus.start({ bookId }),
      ]) {
        await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await expect(b.books.delete({ id: bookId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(invokeLLM).not.toHaveBeenCalled();
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("C declines with block: A is notified and can't re-send; C is hidden from A", async () => {
      const { shareId: cShare } = await as("a").sharing.sendRequest({
        bookId,
        recipientId: ids.c,
      });
      await as("c").sharing.respond({
        shareId: cShare,
        decision: "decline",
        block: true,
      });
      const aNotes = await as("a").sharing.notifications();
      expect(aNotes[0]).toMatchObject({ type: "share_declined" });
      await expect(
        as("a").sharing.sendRequest({ bookId, recipientId: ids.c })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const search = await as("a").sharing.searchUsers({ query: names.c });
      expect(search.items).toEqual([]);
      await expect(
        as("c").books.getStudyContent({ bookId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("owner's Shared-With list, then revoke: B loses access immediately", async () => {
      const list = await as("a").sharing.sharesForBook({ bookId });
      expect(
        list.map(row => [row.recipientUsername, row.status]).sort()
      ).toEqual(
        [
          [names.b, "accepted"],
          [names.c, "declined"],
        ].sort()
      );
      await expect(
        as("b").sharing.sharesForBook({ bookId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(as("b").sharing.revoke({ shareId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      await as("a").sharing.revoke({ shareId });
      await expect(
        as("b").books.getStudyContent({ bookId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        as("b").books.rateCard({ cardId: cardIds[0], rating: "good" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(as("b").examFocus.cards({ bookId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await isFileKeyAccessibleToUser(ids.b, fileKey)).toBe(false);
      expect(await as("b").sharing.sharedWithMe()).toEqual([]);
      // A's pack is untouched.
      const owners = await as("a").books.getStudyContent({ bookId });
      expect(owners.cards).toHaveLength(2);
    });

    it("re-shared later, B's own progress is still there; then B removes it", async () => {
      const { shareId: again } = await as("a").sharing.sendRequest({
        bookId,
        recipientId: ids.b,
      });
      await as("b").sharing.respond({ shareId: again, decision: "accept" });
      const mine = await as("b").books.getStudyContent({ bookId });
      expect(mine.cards.find(c => c.id === cardIds[0])?.reviewCount).toBe(1);
      expect((await as("b").sharing.sharedWithMe())[0]).toMatchObject({
        bookId,
        ownerUsername: names.a,
      });

      await as("b").sharing.removeFromLibrary({ bookId });
      await expect(
        as("b").books.getStudyContent({ bookId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (await as("a").books.getStudyContent({ bookId })).cards
      ).toHaveLength(2);

      const events = await requireDb()
        .select({ event: schema.bookShareEvents.event })
        .from(schema.bookShareEvents)
        .innerJoin(
          schema.bookShares,
          orm.eq(schema.bookShares.id, schema.bookShareEvents.shareId)
        )
        .where(orm.eq(schema.bookShares.bookId, bookId));
      expect(new Set(events.map(e => e.event))).toEqual(
        new Set([
          "request_created",
          "request_accepted",
          "request_declined",
          "sender_blocked",
          "access_revoked",
          "recipient_removed",
        ])
      );
    });
  }
);
