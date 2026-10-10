// Seeds for Protected Doctor Question Sets tests on the PGlite database
// (lib/test-fixtures/pglite-db.ts).
import type { PGlite } from "@electric-sql/pglite";
import { insertUser } from "./pglite-db";

export const IDS = {
  doctorA: "a0000000-0000-4000-8000-00000000000a",
  doctorB: "b0000000-0000-4000-8000-00000000000b",
  student1: "c0000000-0000-4000-8000-000000000001",
  student2: "c0000000-0000-4000-8000-000000000002",
  admin: "d0000000-0000-4000-8000-00000000000d",
} as const;

export const TEST_HMAC_KEY = "test-only-hmac-key-0123456789abcdef-not-a-secret";

export async function seedPeople(client: PGlite) {
  await insertUser(client, { id: IDS.doctorA, name: "Dr A", username: "dra" });
  await insertUser(client, { id: IDS.doctorB, name: "Dr B", username: "drb" });
  await insertUser(client, {
    id: IDS.student1,
    name: "Sara",
    username: "sara",
  });
  await insertUser(client, { id: IDS.student2, name: "Omar" });
  await insertUser(client, { id: IDS.admin, name: "Admin", role: "admin" });
  for (const id of [IDS.doctorA, IDS.doctorB]) {
    await client.query(
      `INSERT INTO doctor_profiles ("userId", status, "fullName", university, faculty, department)
       VALUES ($1, 'approved', $2, 'Uni', 'Medicine', 'Anatomy')`,
      [id, id === IDS.doctorA ? "Dr. A" : "Dr. B"]
    );
  }
}

// A real text PDF of the shape a doctor uploads: numbered questions, A–D
// options, "Answer:" and "Explanation:" lines — what
// lib/question-extraction.ts parses. Same minimal PDF writer as
// forty-page-medical-pdf.ts (no PDF library in the project), one line per
// text row so the parser sees the real line structure.
// One question per page, as in image-bearing banks (a page image can then
// be tied to exactly one question).
export const QUESTION_BANK_PAGES: string[][] = [
  [
    "1. Which nerve supplies the deltoid muscle?",
    "A. Radial nerve",
    "B. Axillary nerve",
    "C. Median nerve",
    "D. Ulnar nerve",
    "Answer: B",
    "Explanation: The axillary nerve (C5-C6) innervates the deltoid.",
  ],
  [
    "2. Which bone forms the point of the elbow?",
    "A. Radius",
    "B. Humerus",
    "C. Ulna",
    "D. Scapula",
    "Answer: C",
  ],
  [
    "3. Which chamber of the heart pumps blood into the aorta?",
    "A. Right atrium",
    "B. Right ventricle",
    "C. Left atrium",
    "D. Left ventricle",
    "Answer: D",
  ],
  [
    "4. What is the normal resting heart rate range in adults?",
    "A. 20-40 beats per minute",
    "B. 60-100 beats per minute",
    "C. 120-160 beats per minute",
    "D. 180-220 beats per minute",
  ],
];

export function buildQuestionBankPdf(
  pages: string[][] = QUESTION_BANK_PAGES
): Buffer {
  const escape = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  // A real figure on every page (a plain grey square), so the page worker —
  // which leaves text-only pages alone (lib/pdf-page-drawing.ts) — has a
  // picture to look at, as it would in a question bank with figures.
  const FIGURE_PX = 96;
  const figure = String.fromCharCode(0xb0).repeat(FIGURE_PX * FIGURE_PX);
  objects[4] =
    `<< /Type /XObject /Subtype /Image /Width ${FIGURE_PX} /Height ${FIGURE_PX} ` +
    `/ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${figure.length} >>\n` +
    `stream\n${figure}\nendstream`;
  let nextId = 5;
  for (const lines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);
    const stream = [
      "BT",
      "/F1 11 Tf",
      "16 TL",
      "50 760 Td",
      ...lines.map(line => `(${escape(line)}) '`),
      "ET",
      "q 300 0 0 300 280 40 cm /Im1 Do Q",
    ].join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// What the existing question-file pipeline leaves behind for a book once
// all three stages have run: complete book, questions with AI done, every
// page processed, one page image linked to the first question.
export async function simulatePipelineDone(
  client: PGlite,
  bookId: string,
  questions = 3
) {
  await client.query(
    `UPDATE books SET status = 'complete', "pageCount" = 2 WHERE id = $1`,
    [bookId]
  );
  const ids: string[] = [];
  for (let i = 0; i < questions; i++) {
    const row = await client.query<{ id: string }>(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerIndex", "sourcePage", "aiStatus", "aiExplanationAr", keywords)
       VALUES ($1, $2, $3, '["A","B","C","D"]', 0, 1, 'complete', 'شرح', '["kw"]') RETURNING id`,
      [bookId, i, `Protected question ${i + 1}?`]
    );
    ids.push(row.rows[0].id);
  }
  for (const page of [1, 2]) {
    await client.query(
      `INSERT INTO question_file_pages ("bookId", "pageNumber", status) VALUES ($1, $2, 'complete')`,
      [bookId, page]
    );
  }
  const image = await client.query<{ id: string }>(
    `INSERT INTO extracted_question_images ("bookId", "pageNumber", "storageKey")
     VALUES ($1, 1, $2) RETURNING id`,
    [bookId, `question-files/${bookId}/page-1_abcd.png`]
  );
  await client.query(
    `INSERT INTO extracted_question_image_relations ("questionId", "imageId") VALUES ($1, $2)`,
    [ids[0], image.rows[0].id]
  );
  return { questionIds: ids, imageId: image.rows[0].id };
}
