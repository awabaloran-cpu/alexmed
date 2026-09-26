import { redirect } from "next/navigation";

// Parts (chapters) no longer have a page of their own: they were a second
// way into the same cards / quiz / summary, which looked like duplicated
// processing to students. A file is studied as a whole from its file page
// (/books/[bookId]/study, /mindmap, /exam-focus, /read). This route only
// keeps old links and bookmarks working:
//   ?page=N                      → the PDF reader at that page
//   ?tool=cards|mcqs|explanation → the same tool for the whole file
//   anything else                → the file page
export default async function ChapterRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string; chapterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { bookId } = await params;
  const query = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const page = Number(first(query.page));
  if (Number.isInteger(page) && page > 0) {
    redirect(`/books/${bookId}/read?page=${page}`);
  }
  const tool = first(query.tool);
  if (tool === "cards" || tool === "mcqs" || tool === "explanation") {
    redirect(`/books/${bookId}/study?tool=${tool}`);
  }
  redirect(`/books/${bookId}`);
}
