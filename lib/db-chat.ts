// Data-access layer for المحادثة مع المصادر (PR5) — mirrors lib/db-books.ts's
// and lib/db-annotations.ts's established conventions. Ownership checks for
// each scope reuse the exact functions those two files already export
// (getBookPageOwnedByUser/getChapterForUser/getBookForUser/
// getSubjectForUser) rather than re-deriving the same joins here.
import { and, asc, desc, eq } from "drizzle-orm";
import {
  bookCards,
  bookPages,
  chatMessages,
  chatSessions,
  type ChatMessage,
  type ChatSession,
} from "../drizzle/schema";
import {
  getBookForUser,
  getBookPageOwnedByUser,
  getChapterForUser,
} from "./db-books";
import { getSubjectForUser } from "./db-subjects";
import { getDb } from "./db";

export type ChatScope = "page" | "chapter" | "book" | "subject";
export type ChatTarget =
  | { scope: "page"; pageId: string }
  | { scope: "chapter"; chapterId: string }
  | { scope: "book"; bookId: string }
  | { scope: "subject"; subjectId: string };

function scopeColumn(scope: ChatScope) {
  switch (scope) {
    case "page":
      return chatSessions.pageId;
    case "chapter":
      return chatSessions.chapterId;
    case "book":
      return chatSessions.bookId;
    case "subject":
      return chatSessions.subjectId;
  }
}

function targetId(target: ChatTarget): string {
  switch (target.scope) {
    case "page":
      return target.pageId;
    case "chapter":
      return target.chapterId;
    case "book":
      return target.bookId;
    case "subject":
      return target.subjectId;
  }
}

// Verifies the student actually owns whatever this scope points at, reusing
// each feature's own existing ownership-check function rather than
// duplicating the join here. Returns false (never throws) so the caller can
// turn it into a clean NOT_FOUND at the tRPC layer.
async function ownsTarget(
  userId: string,
  target: ChatTarget
): Promise<boolean> {
  switch (target.scope) {
    case "page":
      return !!(await getBookPageOwnedByUser(userId, target.pageId));
    case "chapter":
      return !!(await getChapterForUser(userId, target.chapterId));
    case "book":
      return !!(await getBookForUser(userId, target.bookId));
    case "subject":
      return !!(await getSubjectForUser(userId, target.subjectId));
  }
}

// One session per (user, scope, target) — reopening the same page/chapter/
// book/subject's chat resumes the same conversation instead of silently
// starting a new, empty one each time.
export async function getOrCreateChatSession(
  userId: string,
  target: ChatTarget
): Promise<ChatSession | null> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const owns = await ownsTarget(userId, target);
  if (!owns) return null;

  const column = scopeColumn(target.scope);
  const id = targetId(target);
  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.userId, userId), eq(column, id)))
    .orderBy(desc(chatSessions.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(chatSessions)
    .values({
      userId,
      scope: target.scope,
      ...(target.scope === "page" ? { pageId: target.pageId } : {}),
      ...(target.scope === "chapter" ? { chapterId: target.chapterId } : {}),
      ...(target.scope === "book" ? { bookId: target.bookId } : {}),
      ...(target.scope === "subject" ? { subjectId: target.subjectId } : {}),
    })
    .returning();
  return created;
}

export async function getChatSessionForUser(
  userId: string,
  sessionId: string
): Promise<ChatSession | null> {
  const db = getDb();
  if (!db) return null;
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);
  return session ?? null;
}

export async function listChatMessages(
  userId: string,
  sessionId: string
): Promise<ChatMessage[]> {
  const db = getDb();
  if (!db) return [];
  const session = await getChatSessionForUser(userId, sessionId);
  if (!session) return [];
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function appendChatMessage(
  sessionId: string,
  input: {
    role: "user" | "assistant";
    content: string;
    citedPages?: { bookId: string; pageNumber: number }[] | null;
  }
): Promise<ChatMessage> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [message] = await db
    .insert(chatMessages)
    .values({
      sessionId,
      role: input.role,
      content: input.content,
      citedPages: input.citedPages ?? null,
    })
    .returning();

  // Give the session a human-readable title (first user message, truncated)
  // and bump updatedAt — best-effort, only on the first user message.
  if (input.role === "user") {
    const [session] = await db
      .select({ title: chatSessions.title })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    if (session && !session.title) {
      await db
        .update(chatSessions)
        .set({
          title: input.content.slice(0, 80),
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.id, sessionId));
    } else {
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }
  }

  return message;
}

// "تحويل الإجابة إلى ملاحظة أو بطاقة" — targets the FIRST page an assistant
// message actually cited (book/subject-scope answers can cite several; the
// student can always open that page and create more from there directly via
// PR4's own note/highlight flow). Returns null if the message has no
// citation at all (a "no evidence" reply has nothing to attach a note to).
async function resolveMessageTargetPage(userId: string, message: ChatMessage) {
  const cited = message.citedPages?.[0];
  if (!cited) return null;
  const db = getDb();
  if (!db) return null;
  const [page] = await db
    .select({
      id: bookPages.id,
      chapterId: bookPages.chapterId,
      pageNumber: bookPages.pageNumber,
      bookId: bookPages.bookId,
    })
    .from(bookPages)
    .where(
      and(
        eq(bookPages.bookId, cited.bookId),
        eq(bookPages.pageNumber, cited.pageNumber)
      )
    )
    .limit(1);
  if (!page) return null;
  // Ownership check via the existing page-ownership helper.
  const owned = await getBookPageOwnedByUser(userId, page.id);
  if (!owned) return null;
  return page;
}

export async function createNoteFromChatMessage(
  userId: string,
  messageId: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  if (!message || message.role !== "assistant") return null;

  const page = await resolveMessageTargetPage(userId, message);
  if (!page) return null;

  const { annotations } = await import("../drizzle/schema");
  const [note] = await db
    .insert(annotations)
    .values({
      userId,
      bookId: page.bookId,
      pageId: page.id,
      type: "note",
      content: message.content,
    })
    .returning();
  return note;
}

export async function createCardFromChatMessage(
  userId: string,
  messageId: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  if (!message || message.role !== "assistant") return null;

  const page = await resolveMessageTargetPage(userId, message);
  if (!page || !page.chapterId) return null;

  // Find the preceding user question for a meaningful question field.
  const [priorUserMessage] = await db
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, message.sessionId),
        eq(chatMessages.role, "user")
      )
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  const question = priorUserMessage?.content || "سؤالي للمساعد";

  const [card] = await db
    .insert(bookCards)
    .values({
      chapterId: page.chapterId,
      userId,
      questionAr: question,
      questionEn: question,
      answerAr: message.content,
      answerEn: message.content,
      relatedTermEn: "",
      sourcePage: page.pageNumber,
    })
    .returning();
  return card;
}
