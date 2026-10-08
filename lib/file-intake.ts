// The one way a student's uploaded PDF enters processing — shared by the
// web upload routes (app/api/books/extract-and-plan,
// extract-questions-and-plan) and the Telegram gateway (lib/telegram), so
// every channel pays the same plan checks and starts the same pipeline:
//   1. the key was issued to this user, the stored file's real size fits
//      the plan, and one file is taken from the quota (admitUpload),
//   2. a bare books row is created (status "extracting"),
//   3. one queue message starts the existing worker.
// If step 2 or 3 fails the quota unit is given back.
//
// Callers do their own request-level checks first (who the user is, the
// job-creation rate limit, that `subjectId` is the user's own folder).
import { NextResponse } from "next/server";
import type { Book } from "../drizzle/schema";
import { admitUpload } from "./billing/upload-guard";
import { createBookShell } from "./db-books";
import { createQuestionFileShell } from "./db-question-files";
import { publishMessage } from "./queue/client";

export type StudentFileInput = {
  kind: "book" | "question_file";
  key: string;
  fileName: string;
  subjectId: string;
  profile?: Book["profile"];
};

// A NextResponse is the refusal to hand back as-is (its JSON body carries
// the Arabic `error` text, and the billing fields when a plan limit hit).
export async function admitAndStartStudentFile(
  userId: string,
  input: StudentFileInput
): Promise<{ bookId: string } | NextResponse> {
  const isBook = input.kind === "book";

  // 💳 Plan: the stored file's real size + one file from the quota.
  const admitted = await admitUpload(
    userId,
    input.key,
    isBook ? "BOOK_FILE" : "QUESTION_FILE"
  );
  if (admitted instanceof NextResponse) return admitted;

  let book: Book;
  try {
    book = isBook
      ? await createBookShell(userId, {
          fileName: input.fileName,
          fileKey: input.key,
          profile: input.profile,
          subjectId: input.subjectId,
        })
      : await createQuestionFileShell(userId, {
          fileName: input.fileName,
          fileKey: input.key,
          subjectId: input.subjectId,
        });
  } catch (error) {
    await admitted.release();
    throw error;
  }

  try {
    if (isBook) {
      await publishMessage(
        { type: "extract_book_job", bookId: book.id },
        { flowControl: { key: `books-extract-${book.id}`, parallelism: 1 } }
      );
    } else {
      await publishMessage({
        type: "extract_question_file_job",
        bookId: book.id,
      });
    }
  } catch (publishError) {
    console.error(
      isBook
        ? "[Books] Failed to enqueue extraction"
        : "[QuestionFiles] Failed to enqueue extraction",
      publishError
    );
    await admitted.release();
    return NextResponse.json(
      {
        error: isBook
          ? "تم إنشاء الكتاب لكن تعذر بدء المعالجة. حاول إعادة رفع الملف."
          : "تم إنشاء الملف لكن تعذر بدء الاستخراج. حاول إعادة رفع الملف.",
      },
      { status: 502 }
    );
  }

  return { bookId: book.id };
}
