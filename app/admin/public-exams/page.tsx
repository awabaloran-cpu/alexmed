"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

const STATUS_LABELS = {
  draft: "مسودة",
  published: "منشور",
  paused: "متوقف",
  archived: "مؤرشف",
} as const;

function dateLabel(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

// Public Exams are only a publishing layer over existing Question Files: admins
// pick a completed question file, then publish / pause / archive the public
// exam without changing the underlying file or its protected uses.
export default function AdminPublicExamsPage() {
  const utils = trpc.useUtils();
  const exams = trpc.adminPublicExams.list.useQuery(undefined, { retry: false });
  const files = trpc.adminPublicExams.questionFiles.useQuery(undefined, {
    retry: false,
  });
  const [bookId, setBookId] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [questionLimit, setQuestionLimit] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const refresh = () => utils.adminPublicExams.list.invalidate();
  const create = trpc.adminPublicExams.create.useMutation({
    onSuccess: async () => {
      await refresh();
      setTitle("");
      setSlug("");
      setQuestionLimit("");
      setDurationMinutes("");
    },
  });
  const publish = trpc.adminPublicExams.publish.useMutation({ onSuccess: refresh });
  const pause = trpc.adminPublicExams.pause.useMutation({ onSuccess: refresh });
  const archive = trpc.adminPublicExams.archive.useMutation({ onSuccess: refresh });
  const actionError = create.error ?? publish.error ?? pause.error ?? archive.error;

  const readyFiles = useMemo(
    () => (files.data ?? []).filter(file => file.status === "complete"),
    [files.data]
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    create.mutate({
      bookId,
      title,
      slug: slug || null,
      questionLimit: questionLimit ? Number(questionLimit) : null,
      durationSeconds: durationMinutes ? Number(durationMinutes) * 60 : null,
      shuffleQuestions: true,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الامتحانات العامة</h1>
        <p className="text-sm text-muted-foreground">
          نشر امتحانات عامة من ملفات الأسئلة الحالية بدون كشف الإجابات أو مفاتيح
          التخزين للمتصفح.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-2"
      >
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="bookId">ملف الأسئلة</Label>
          <select
            id="bookId"
            required
            value={bookId}
            onChange={event => setBookId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">اختر ملفًا مكتمل المعالجة</option>
            {readyFiles.map(file => (
              <option key={file.id} value={file.id}>
                {file.fileName} — {file.questionCount} سؤال
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">عنوان الامتحان</Label>
          <Input
            id="title"
            required
            minLength={3}
            value={title}
            onChange={event => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">الرابط المختصر (اختياري)</Label>
          <Input
            id="slug"
            dir="ltr"
            value={slug}
            onChange={event => setSlug(event.target.value)}
            placeholder="pediatrics-vomiting"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="questionLimit">عدد الأسئلة (اختياري)</Label>
          <Input
            id="questionLimit"
            type="number"
            min={1}
            max={1000}
            value={questionLimit}
            onChange={event => setQuestionLimit(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="durationMinutes">المدة بالدقائق (اختياري)</Label>
          <Input
            id="durationMinutes"
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={event => setDurationMinutes(event.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Button type="submit" disabled={create.isPending || !bookId}>
            {create.isPending ? "جاري الإنشاء..." : "إنشاء امتحان عام"}
          </Button>
        </div>
      </form>

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError.message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الامتحان</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الأسئلة</TableHead>
              <TableHead>الملف</TableHead>
              <TableHead>نُشر في</TableHead>
              <TableHead>إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(exams.data ?? []).map(exam => (
              <TableRow key={exam.id}>
                <TableCell>
                  <div className="font-medium">{exam.title}</div>
                  <a
                    className="text-xs text-primary underline"
                    href={`/exam/${exam.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                  >
                    /exam/{exam.slug}
                  </a>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{STATUS_LABELS[exam.status]}</Badge>
                </TableCell>
                <TableCell>
                  {exam.questionLimit ?? exam.extractedQuestions} · دخول بعد{" "}
                  {exam.freeQuestionsBeforeLogin}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{exam.fileName}</div>
                  {exam.bookStatus !== "complete" ? (
                    <div className="text-xs text-destructive">
                      الملف غير مكتمل حاليًا
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{dateLabel(exam.publishedAt)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {exam.status !== "published" && exam.status !== "archived" ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-sm"
                        onClick={() => publish.mutate({ examId: exam.id })}
                      >
                        نشر
                      </button>
                    ) : null}
                    {exam.status === "published" ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-sm"
                        onClick={() => pause.mutate({ examId: exam.id })}
                      >
                        إيقاف مؤقت
                      </button>
                    ) : null}
                    {exam.status !== "archived" ? (
                      <button
                        type="button"
                        className="rounded-md border border-destructive px-2 py-1 text-sm text-destructive"
                        onClick={() => archive.mutate({ examId: exam.id })}
                      >
                        أرشفة
                      </button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {exams.data && !exams.data.length ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  لا توجد امتحانات عامة بعد.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
