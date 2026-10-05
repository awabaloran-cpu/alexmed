"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc-client";

function storedAnonymousId(slug: string) {
  const key = `nirolearn_public_exam_anon_${slug}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function storedSessionId(slug: string) {
  try {
    return window.localStorage.getItem(`nirolearn_public_exam_session_${slug}`);
  } catch {
    return null;
  }
}

function saveSessionId(slug: string, sessionId: string) {
  try {
    window.localStorage.setItem(`nirolearn_public_exam_session_${slug}`, sessionId);
  } catch {}
}

function remainingLabel(expiresAt: string | null, serverNow: string) {
  if (!expiresAt) return null;
  const remaining = Math.max(
    0,
    new Date(expiresAt).getTime() - new Date(serverNow).getTime()
  );
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function PublicExamClient({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    correctIndex: number | null;
    explanation: string | null;
    extractedAnswerText: string | null;
    finished: boolean;
  } | null>(null);

  useEffect(() => {
    setAnonymousId(storedAnonymousId(slug));
    setSessionId(searchParams.get("session") ?? storedSessionId(slug));
  }, [searchParams, slug]);

  const tracking = useMemo(
    () => ({
      source: searchParams.get("source") ?? searchParams.get("utm_source"),
      utmSource: searchParams.get("utm_source"),
      utmMedium: searchParams.get("utm_medium"),
      utmCampaign: searchParams.get("utm_campaign"),
      utmContent: searchParams.get("utm_content"),
      utmTerm: searchParams.get("utm_term"),
      telegramPayload: searchParams.get("tg")
        ? { payload: searchParams.get("tg") }
        : null,
    }),
    [searchParams]
  );

  const exam = trpc.publicExams.get.useQuery({ slug }, { retry: false });
  const start = trpc.publicExams.startOrResume.useMutation({
    onSuccess: data => {
      saveSessionId(slug, data.session.id);
      setSessionId(data.session.id);
      setSelectedIndex(data.question?.selectedIndex ?? null);
      setFeedback(null);
    },
  });
  const session = trpc.publicExams.session.useQuery(
    { sessionId: sessionId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(sessionId), retry: false }
  );
  const submit = trpc.publicExams.submitAnswer.useMutation({
    onSuccess: data => {
      setFeedback({
        isCorrect: data.isCorrect,
        correctIndex: data.correctIndex,
        explanation: data.explanation,
        extractedAnswerText: data.extractedAnswerText,
        finished: data.finished,
      });
      void session.refetch();
    },
  });

  const data = session.data ?? start.data;
  const question = data?.question ?? null;
  const options = question?.optionsAr ?? question?.options ?? [];
  const progress = data
    ? Math.round((data.session.answeredCount / data.session.totalQuestions) * 100)
    : 0;
  const loginUrl = data
    ? `/login?callbackUrl=${encodeURIComponent(`/exam/${slug}?session=${data.session.id}`)}`
    : "/login";

  useEffect(() => {
    if (!data?.session.requiresLogin) return;
    router.push(loginUrl);
  }, [data?.session.requiresLogin, loginUrl, router]);

  function startExam() {
    if (!anonymousId) return;
    start.mutate({ slug, anonymousId, sessionId, tracking });
  }

  function submitAnswer() {
    if (!data?.session.id || !question || selectedIndex === null) return;
    submit.mutate({
      sessionId: data.session.id,
      questionId: question.id,
      selectedIndex,
    });
  }

  function continueNext() {
    setFeedback(null);
    setSelectedIndex(null);
    if (data?.session.id) void session.refetch();
  }

  function finishExam() {
    setFeedback(null);
    setSelectedIndex(null);
    if (data?.session.id) void session.refetch();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link href="/" className="text-sm font-semibold text-primary">
          NiroLearn
        </Link>
        {data ? (
          <div className="text-sm text-muted-foreground">
            {data.session.expiresAt ? (
              <span>الوقت المتبقي: {remainingLabel(data.session.expiresAt, data.session.serverNow)}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {!data ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="mb-2 text-sm text-muted-foreground">امتحان عام</p>
          <h1 className="mb-3 text-3xl font-bold">
            {exam.data?.title ?? "جاهز تبدأ الامتحان؟"}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {exam.data?.description ??
              "سنعرض سؤالًا واحدًا في كل مرة. الإجابات والنتيجة تُحسب على الخادم، وبعد عدد الأسئلة المجاني سيُطلب منك تسجيل الدخول للمتابعة من نفس المكان."}
          </p>
          {exam.data && !exam.data.available ? (
            <p className="mb-4 text-sm text-muted-foreground">
              هذا الامتحان غير مفتوح حاليًا.
            </p>
          ) : null}
          {exam.error ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {exam.error.message}
            </p>
          ) : start.error ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {start.error.message}
            </p>
          ) : null}
          <Button
            onClick={startExam}
            disabled={
              !anonymousId ||
              start.isPending ||
              exam.isLoading ||
              !exam.data?.available
            }
          >
            {start.isPending ? "جاري البدء..." : "ابدأ الامتحان"}
          </Button>
        </section>
      ) : (
        <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div>
            <p className="text-sm text-muted-foreground">{data.exam.title}</p>
            <h1 className="mt-1 text-2xl font-bold">
              سؤال {data.session.currentQuestionIndex + 1} من {data.session.totalQuestions}
            </h1>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={progress} className="h-2 flex-1" />
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
          </div>

          {data.session.status === "submitted" ? (
            <div className="rounded-xl bg-secondary p-5 text-center">
              <h2 className="text-xl font-bold">انتهى الامتحان</h2>
              <p className="mt-2 text-muted-foreground">
                نتيجتك: {data.session.score} من {data.session.totalQuestions}
              </p>
            </div>
          ) : data.session.requiresLogin ? (
            <div className="rounded-xl border border-border p-5 text-center">
              <h2 className="text-xl font-bold">سجّل الدخول للمتابعة</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                سنعيدك إلى نفس الامتحان ونفس السؤال بعد تسجيل الدخول.
              </p>
              <Button asChild className="mt-4">
                <Link href={loginUrl}>تسجيل الدخول</Link>
              </Button>
            </div>
          ) : question ? (
            <>
              {question.imageUrl ? (
                <div className="overflow-hidden rounded-xl border border-border bg-background">
                  <Image
                    src={question.imageUrl}
                    alt="صورة السؤال"
                    width={1200}
                    height={800}
                    className="h-auto w-full"
                    unoptimized
                  />
                </div>
              ) : null}
              <article className="space-y-4">
                <p className="text-lg leading-8">{question.questionTextAr ?? question.questionText}</p>
                <div className="space-y-2">
                  {options.map((option, index) => {
                    const isCorrect = feedback?.correctIndex === index;
                    const isSelected = selectedIndex === index;
                    return (
                      <button
                        key={`${question.id}-${index}`}
                        type="button"
                        disabled={Boolean(feedback) || submit.isPending}
                        onClick={() => setSelectedIndex(index)}
                        className={`w-full rounded-xl border px-4 py-3 text-start transition ${
                          feedback
                            ? isCorrect
                              ? "border-green-500 bg-green-500/10"
                              : isSelected
                                ? "border-destructive bg-destructive/10"
                                : "border-border"
                            : isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-secondary"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </article>

              {!options.length ? (
                <p className="text-sm text-muted-foreground">
                  هذا السؤال لا يحتوي خيارات ظاهرة، لذلك لا يمكن إجابته من الامتحان العام.
                </p>
              ) : null}

              {submit.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {submit.error.message}
                </p>
              ) : null}

              {feedback ? (
                <div className="rounded-xl bg-secondary p-4">
                  <p className="font-semibold">
                    {feedback.isCorrect ? "إجابة صحيحة ✅" : "إجابة غير صحيحة"}
                  </p>
                  {feedback.extractedAnswerText ? (
                    <p className="mt-2 text-sm">الإجابة: {feedback.extractedAnswerText}</p>
                  ) : null}
                  {feedback.explanation ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {feedback.explanation}
                    </p>
                  ) : null}
                  <Button
                    className="mt-4"
                    onClick={feedback.finished ? finishExam : continueNext}
                  >
                    {feedback.finished ? "عرض النتيجة" : "التالي"}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={submitAnswer}
                  disabled={!options.length || selectedIndex === null || submit.isPending}
                >
                  {submit.isPending ? "جاري التصحيح..." : "تأكيد الإجابة"}
                </Button>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">لا يوجد سؤال متاح حاليًا.</p>
          )}
        </section>
      )}
    </div>
  );
}
