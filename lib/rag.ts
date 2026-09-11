// Retrieval for المحادثة مع المصادر (PR5) — see the "annotations (PR4)"-style
// header comment on chatSessions in drizzle/schema.ts for why this is
// keyword/full-text search (Postgres to_tsvector/plainto_tsquery), not
// embedding-based semantic search: no pgvector extension or confirmed
// production embedding model exists yet. "simple" config is used (not
// "arabic", which Postgres doesn't ship) so Arabic and English text both
// just get whitespace/punctuation tokenization — no stemming, but exact/
// near-exact keyword matches (which is what a student's question usually
// contains, e.g. a term copied from the book) still rank and match fine.
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export type RetrievedChunk = {
  bookId: string;
  bookFileName: string;
  chapterId: string | null;
  pageNumber: number;
  text: string;
};

const SEARCH_LIMIT = 5;
// Keeps a single invokeLLM call's prompt bounded regardless of how many/how
// large the matched pages are — chunks are added in rank order until the
// budget is hit, never mid-chunk truncated (a half-sentence of "evidence"
// is worse than one fewer whole page of it).
const MAX_CONTEXT_CHARS = 12_000;

export function capChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (kept.length && total + chunk.text.length > MAX_CONTEXT_CHARS) break;
    kept.push(chunk);
    total += chunk.text.length;
  }
  return kept;
}

// scope="page" never searches — the one page IS the context, in full.
export async function getPageChunk(pageId: string): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute<{
    bookId: string;
    bookFileName: string;
    chapterId: string | null;
    pageNumber: number;
    text: string | null;
  }>(sql`
    select bp."bookId" as "bookId",
           b."fileName" as "bookFileName",
           bp."chapterId" as "chapterId",
           bp."pageNumber" as "pageNumber",
           bp."extractedText" as "text"
    from book_pages bp
    inner join books b on b.id = bp."bookId"
    where bp.id = ${pageId}
    limit 1
  `);
  const row = rows[0];
  if (!row || !row.text) return [];
  return [{ ...row, text: row.text }];
}

// scope="chapter" — ranked search within just this chapter's own pages, so
// a long chapter still gets a bounded, relevant context instead of every
// page dumped in regardless of relevance to the actual question.
export async function searchChapterPages(
  chapterId: string,
  query: string,
  limit = SEARCH_LIMIT
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute<{
    bookId: string;
    bookFileName: string;
    chapterId: string | null;
    pageNumber: number;
    text: string | null;
  }>(sql`
    select bp."bookId" as "bookId",
           b."fileName" as "bookFileName",
           bp."chapterId" as "chapterId",
           bp."pageNumber" as "pageNumber",
           bp."extractedText" as "text"
    from book_pages bp
    inner join books b on b.id = bp."bookId"
    where bp."chapterId" = ${chapterId}
      and bp."extractedText" is not null
      and to_tsvector('simple', bp."extractedText") @@ plainto_tsquery('simple', ${query})
    order by ts_rank(to_tsvector('simple', bp."extractedText"), plainto_tsquery('simple', ${query})) desc
    limit ${limit}
  `);
  return capChunks(
    rows.filter((row): row is typeof row & { text: string } => !!row.text)
  );
}

// scope="book" — same idea across the whole book.
export async function searchBookPages(
  bookId: string,
  query: string,
  limit = SEARCH_LIMIT
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute<{
    bookId: string;
    bookFileName: string;
    chapterId: string | null;
    pageNumber: number;
    text: string | null;
  }>(sql`
    select bp."bookId" as "bookId",
           b."fileName" as "bookFileName",
           bp."chapterId" as "chapterId",
           bp."pageNumber" as "pageNumber",
           bp."extractedText" as "text"
    from book_pages bp
    inner join books b on b.id = bp."bookId"
    where bp."bookId" = ${bookId}
      and bp."extractedText" is not null
      and to_tsvector('simple', bp."extractedText") @@ plainto_tsquery('simple', ${query})
    order by ts_rank(to_tsvector('simple', bp."extractedText"), plainto_tsquery('simple', ${query})) desc
    limit ${limit}
  `);
  return capChunks(
    rows.filter((row): row is typeof row & { text: string } => !!row.text)
  );
}

// scope="subject" — across every book that belongs to the subject. Never
// mixes in another subject's books, and never falls back to "book" or
// "chapter" scope's data — "عدم خلط المصادر إلا إذا طلب المستخدم
// المقارنة صراحة" is enforced structurally here (the WHERE clause), not
// just by prompt wording.
export async function searchSubjectPages(
  subjectId: string,
  query: string,
  limit = SEARCH_LIMIT
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute<{
    bookId: string;
    bookFileName: string;
    chapterId: string | null;
    pageNumber: number;
    text: string | null;
  }>(sql`
    select bp."bookId" as "bookId",
           b."fileName" as "bookFileName",
           bp."chapterId" as "chapterId",
           bp."pageNumber" as "pageNumber",
           bp."extractedText" as "text"
    from book_pages bp
    inner join books b on b.id = bp."bookId"
    where b."subjectId" = ${subjectId}
      and bp."extractedText" is not null
      and to_tsvector('simple', bp."extractedText") @@ plainto_tsquery('simple', ${query})
    order by ts_rank(to_tsvector('simple', bp."extractedText"), plainto_tsquery('simple', ${query})) desc
    limit ${limit}
  `);
  return capChunks(
    rows.filter((row): row is typeof row & { text: string } => !!row.text)
  );
}

export const NO_EVIDENCE_MESSAGE_AR =
  "لا يوجد دليل كافٍ في المصدر المحدد للإجابة على هذا السؤال. جرّب إعادة صياغة السؤال أو توسيع نطاق البحث (الفصل/الكتاب/المادة).";

function scopeLabel(scope: "page" | "chapter" | "book" | "subject"): string {
  switch (scope) {
    case "page":
      return "the current page only";
    case "chapter":
      return "the current chapter only";
    case "book":
      return "the current book only";
    case "subject":
      return "every book in the current subject";
  }
}

// System prompt shared by every scope — the only thing that changes is
// which pages were actually retrieved into the "SOURCE EXCERPTS" block
// built by the caller (lib/trpc/chatRouter.ts).
export function buildRagSystemPrompt(
  scope: "page" | "chapter" | "book" | "subject"
): string {
  return [
    "You are a study assistant answering questions about a student's own uploaded material.",
    `Your knowledge for this conversation is limited to ${scopeLabel(scope)} — the SOURCE EXCERPTS provided in the user message below, each tagged with its page number.`,
    "Answer ONLY using those excerpts. Cite the page number for every fact (e.g. 'صفحة 12'). Never invent facts not present in the excerpts, and never pull in outside knowledge to fill a gap.",
    "If the excerpts don't contain enough information to answer, say so plainly in Arabic instead of guessing.",
    "If asked to quiz the student ('اختبرني'), ask ONE question from the excerpts and wait for their answer — do not reveal the correct answer until they respond or explicitly ask for it.",
    "Answer in Arabic by default, matching the student's own language when they write in English.",
  ].join("\n");
}

export function buildContextBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      chunk =>
        `\n===== ${chunk.bookFileName} — صفحة ${chunk.pageNumber} =====\n${chunk.text}`
    )
    .join("\n");
}
