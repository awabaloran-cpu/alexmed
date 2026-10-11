"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Copy, Download, Loader2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/router";
import { trpc } from "@/lib/trpc-client";
import QuestionList from "@/components/questions/QuestionList";
import s from "@/components/doctor-sets/doctorSets.module.css";
import StatusChip from "@/components/doctor-sets/StatusChip";
import SetSettingsFields, {
  settingsFromSet,
  settingsPayload,
  type SetSettingsValue,
} from "@/components/doctor-sets/SetSettingsFields";
import {
  AUDIT_EVENT_LABELS,
  formatDateTime,
  setStatusLabel,
} from "@/components/doctor-sets/labels";

type Tab = "questions" | "settings" | "codes" | "students" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "questions", label: "الأسئلة" },
  { id: "settings", label: "الإعدادات" },
  { id: "codes", label: "الأكواد" },
  { id: "students", label: "الطلاب" },
  { id: "audit", label: "السجل" },
];

const POLL_MS = 4000;
// No step forward for this long while a draft is being prepared: the run
// has probably stopped, and the doctor is offered "resume".
const STALLED_AFTER_MS = 3 * 60_000;

export default function QuestionSetPage() {
  const { setId } = useParams<{ setId: string }>();
  const [tab, setTab] = useState<Tab>("questions");
  const setQuery = trpc.doctor.sets.get.useQuery(
    { setId },
    {
      refetchInterval: query =>
        query.state.data?.set.status === "draft" &&
        !query.state.data.set.processingDone &&
        query.state.data.set.bookStatus !== "failed"
          ? POLL_MS
          : false,
    }
  );

  // Pick the tab from ?tab= once (links from the dashboard / after publish).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some(t => t.id === wanted)) setTab(wanted as Tab);
  }, []);

  if (setQuery.isLoading) {
    return (
      <section className="upload-view">
        <div className={s.page}>
          <p className={s.note}>جاري التحميل...</p>
        </div>
      </section>
    );
  }
  if (!setQuery.data) {
    return (
      <section className="upload-view">
        <div className={s.page}>
          <div className={s.empty}>
            <strong>المجموعة غير موجودة.</strong>
            <Link href="/doctor" className="secondary-button">
              لوحة الدكتور
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const { set, coverage } = setQuery.data;
  const status = setStatusLabel(set);

  return (
    <section className="upload-view">
      <div className={s.page}>
        <header className={s.header}>
          <Link href="/doctor" className={s.back}>
            ‹ لوحة الدكتور
          </Link>
          <h1>{set.title}</h1>
          <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatusChip {...status} />
            <span>
              {set.status === "draft"
                ? `${set.extractedQuestions} سؤال مستخرج`
                : `${set.questionCount} سؤال`}{" "}
              · {set.activeStudents} طالب ·{" "}
              {set.visibility === "listed" ? "مدرجة" : "غير مدرجة"}
            </span>
          </p>
        </header>

        <div className={s.tabs} role="tablist" aria-label="أقسام المجموعة">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={s.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "questions" && (
            <QuestionsTab
              setId={setId}
              set={set}
              coverage={coverage}
              onPublished={() => setQuery.refetch()}
            />
          )}
          {tab === "settings" && (
            <SettingsTab
              setId={setId}
              set={set}
              onChanged={() => setQuery.refetch()}
            />
          )}
          {tab === "codes" && (
            <CodesTab setId={setId} published={set.status === "published"} />
          )}
          {tab === "students" && <StudentsTab setId={setId} />}
          {tab === "audit" && <AuditTab setId={setId} />}
        </div>
      </div>
    </section>
  );
}

type SetOutput = inferRouterOutputs<AppRouter>["doctor"]["sets"]["get"];
type SetData = SetOutput["set"];
type Coverage = SetOutput["coverage"];

function QuestionsTab({
  setId,
  set,
  coverage,
  onPublished,
}: {
  setId: string;
  set: SetData;
  coverage: Coverage;
  onPublished: () => void;
}) {
  const preview = trpc.doctor.sets.preview.useQuery(
    { setId },
    { refetchInterval: set.processingDone ? false : POLL_MS }
  );
  const publish = trpc.doctor.sets.publish.useMutation({
    onSuccess: onPublished,
  });
  const [showAll, setShowAll] = useState(false);
  const retry = trpc.doctor.sets.retryProcessing.useMutation({
    onSuccess: onPublished,
  });
  const router = useRouter();
  const resume = trpc.doctor.sets.resume.useMutation({
    onSuccess: onPublished,
  });
  const cancel = trpc.doctor.sets.cancel.useMutation({
    onSuccess: () => router.replace("/doctor"),
  });
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Has anything moved? The numbers are read every few seconds; when they
  // have stood still for a while the preparation has probably stopped.
  const preparing =
    set.status === "draft" &&
    set.bookStatus !== "failed" &&
    !set.processingDone;
  const progress = `${set.bookStatus}:${coverage.questionsTotal}:${coverage.questionsAiComplete}:${coverage.imagePagesProcessed}`;
  const [movedAt, setMovedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setMovedAt(Date.now());
  }, [progress]);
  useEffect(() => {
    if (!preparing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [preparing]);
  const stalled = preparing && now - movedAt > STALLED_AFTER_MS;

  return (
    <div className={s.section}>
      {set.status === "draft" && set.bookStatus === "failed" && (
        <div className="inline-alert error wide">
          <span>{set.extractionError || "تعذر استخراج الأسئلة من الملف."}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ setId })}
          >
            إعادة المعالجة
          </button>
        </div>
      )}

      {set.status === "draft" &&
        set.bookStatus !== "failed" &&
        !set.processingDone && (
          <div className="inline-alert warning wide" role="status">
            <Loader2 size={16} className="spin" aria-hidden="true" />
            جاري المعالجة بنفس نظام ملفات الأسئلة —{" "}
            {coverage.questionsTotal
              ? `الشرح ${coverage.questionsAiComplete}/${coverage.questionsTotal}، الصور ${coverage.imagePagesProcessed}/${coverage.imagePagesTotal} صفحة`
              : "استخراج الأسئلة"}
            . تقدر تسكّر الصفحة وترجع، وسيصلك إشعار عند الاكتمال.
          </div>
        )}

      {stalled && set.bookStatus === "complete" && (
        <div className="inline-alert error wide" role="alert">
          <span>
            لم يتقدّم التجهيز منذ بضع دقائق. قد يكون توقف بسبب عطل مؤقت.
            الاستئناف يكمل ما بقي فقط ولا يعيد ما اكتمل.
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={resume.isPending}
            onClick={() => {
              setMovedAt(Date.now());
              resume.mutate({ setId });
            }}
          >
            {resume.isPending ? "جاري الاستئناف..." : "استئناف"}
          </button>
        </div>
      )}

      {set.status === "draft" &&
        set.processingDone &&
        set.aiFailedCount > 0 && (
          <div className="inline-alert warning wide" role="status">
            <span>
              تعذّر كتابة الشرح لـ {set.aiFailedCount} سؤالًا. الأسئلة نفسها
              سليمة وتُنشر بدون شرح، أو أعد المحاولة لها الآن.
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={resume.isPending}
              onClick={() => resume.mutate({ setId })}
            >
              {resume.isPending ? "جاري الإرسال..." : "أعد المحاولة للشرح"}
            </button>
          </div>
        )}

      {resume.error ? (
        <p className={s.error} role="alert">
          {resume.error.message}
        </p>
      ) : null}

      {set.status === "draft" && set.processingDone && (
        <div className={s.freshCodes}>
          <strong>راجع الأسئلة أدناه كما سيراها طلابك.</strong>
          <span className={s.note}>
            بعد النشر لا يمكن تغيير الأسئلة. إن احتجت تعديلها، أنشئ مجموعة جديدة
            بملف مصحح.
          </span>
          {publish.error ? (
            <p className={s.error} role="alert">
              {publish.error.message}
            </p>
          ) : null}
          <div className={s.actions}>
            <button
              type="button"
              className="nl-marker-button"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ setId })}
            >
              {publish.isPending ? "جاري النشر..." : "انشر المجموعة"}
            </button>
          </div>
        </div>
      )}

      {set.status === "draft" && (
        <div className={s.actions}>
          {confirmCancel ? (
            <>
              <span className={s.note} role="alert">
                تُحذف المسودة وملفها نهائيًا، ويتوقف تجهيزها. لا يمكن التراجع.
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ setId })}
              >
                {cancel.isPending ? "جاري الحذف..." : "نعم، احذف المسودة"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={cancel.isPending}
                onClick={() => setConfirmCancel(false)}
              >
                تراجع
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirmCancel(true)}
            >
              {preparing ? "إلغاء المعالجة وحذف الملف" : "حذف المسودة"}
            </button>
          )}
          {cancel.error ? (
            <p className={s.error} role="alert">
              {cancel.error.message}
            </p>
          ) : null}
        </div>
      )}

      {preview.data?.questions.length ? (
        <>
          <div className={s.actions}>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={showAll}
              onClick={() => setShowAll(value => !value)}
            >
              {showAll ? "إخفاء الإجابات" : "أظهر كل الإجابات"}
            </button>
            {preview.data.questions.some(
              q => q.translationSource === "machine"
            ) && (
              <span className={s.note}>
                بعض الترجمات آلية (عليها وسم «ترجمة آلية») — راجعها.
              </span>
            )}
          </div>
          <QuestionList
            questions={preview.data.questions}
            revealAll={showAll}
            layout={showAll ? "list" : "deck"}
          />
        </>
      ) : preview.isLoading ? (
        <p className={s.note}>جاري تحميل الأسئلة...</p>
      ) : (
        <div className={s.empty}>
          <strong>لا توجد أسئلة مستخرجة بعد.</strong>
        </div>
      )}

      {!!preview.data?.questions.some(
        q => q.reviewStatus === "check_image"
      ) && (
        <div className={s.section}>
          <h2 style={{ margin: 0, fontSize: 16 }}>صور تحتاج مراجعة</h2>
          <p className={s.note}>
            في هذه الصفحات صورة لم يكن واضحًا لأي سؤال تعود، فلم تُربط بأي سؤال
            (الأسئلة نفسها ظاهرة للطلاب بدون صورة).
          </p>
          <ul className={s.list}>
            {preview.data.questions
              .map((q, i) => ({ q, i }))
              .filter(({ q }) => q.reviewStatus === "check_image")
              .map(({ q, i }) => (
                <li key={q.id} className={s.row}>
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>
                      سؤال {i + 1} · صفحة {q.sourcePage}
                    </span>
                    <span className={s.rowMeta} dir="auto">
                      {q.questionText.slice(0, 140)}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {!!preview.data?.needsReview.length && (
        <NeedsReviewSection items={preview.data.needsReview} />
      )}
    </div>
  );
}

const REVIEW_REASON_LABELS: Record<string, string> = {
  empty_or_fragment_stem: "نص السؤال فارغ أو مجرد جزء",
  incomplete_stem: "نص السؤال مقطوع قبل نهايته",
  answer_inside_stem: "الإجابة مكتوبة داخل نص السؤال",
  single_option: "خيار واحد فقط",
  too_many_options: "خيارات أكثر من المعقول (قد يكون سؤالان مدموجان)",
  empty_option: "خيار فارغ",
  answer_or_explanation_inside_option: "إجابة أو شرح داخل أحد الخيارات",
  next_question_inside_option: "بداية السؤال التالي داخل أحد الخيارات",
  missing_options: "لا توجد خيارات لهذا السؤال",
  options_out_of_order: "ترتيب الخيارات غير سليم",
};

// Blocks the pipeline found but couldn't validate: never shown to
// students; the doctor sees exactly what was read and why it was held back
// (fix the file and create a new set, or ignore them).
function NeedsReviewSection({
  items,
}: {
  items: {
    id: string;
    questionText: string;
    options: string[] | null;
    sourcePage: number;
    reasons: string[];
  }[];
}) {
  return (
    <div className={s.section}>
      <h2 style={{ margin: 0, fontSize: 16 }}>
        تحتاج مراجعة (Needs Review) · {items.length}
      </h2>
      <p className={s.note}>
        هذه الأجزاء لم تُعتبر أسئلة مكتملة، فلا يراها طلابك. لم يُكمل النظام أي
        نص ناقص من عنده.
      </p>
      <ul className={s.list}>
        {items.map(item => (
          <li key={item.id} className={s.row} style={{ display: "grid" }}>
            <span className={s.rowTitle}>صفحة {item.sourcePage}</span>
            <span className={s.rowMeta} dir="auto">
              {item.questionText || "(بدون نص سؤال)"}
            </span>
            {!!item.options?.length && (
              <ol className={s.rowMeta} dir="auto" style={{ margin: 0 }}>
                {item.options.map((option, i) => (
                  <li key={i}>{option}</li>
                ))}
              </ol>
            )}
            <span className={s.chip}>
              {item.reasons
                .map(
                  reason =>
                    `${REVIEW_REASON_LABELS[reason] ?? reason} (${reason})`
                )
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsTab({
  setId,
  set,
  onChanged,
}: {
  setId: string;
  set: SetData;
  onChanged: () => void;
}) {
  const [value, setValue] = useState<SetSettingsValue>(() =>
    settingsFromSet(set)
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const update = trpc.doctor.sets.update.useMutation({ onSuccess: onChanged });
  const disable = trpc.doctor.sets.disable.useMutation({
    onSuccess: onChanged,
  });
  const enable = trpc.doctor.sets.enable.useMutation({ onSuccess: onChanged });
  const archive = trpc.doctor.sets.archive.useMutation({
    onSuccess: onChanged,
  });
  const error =
    update.error ?? disable.error ?? enable.error ?? archive.error ?? null;
  const archived = set.status === "archived";

  return (
    <div className={s.section}>
      <form
        className={s.form}
        onSubmit={event => {
          event.preventDefault();
          update.mutate({ setId, ...settingsPayload(value) });
        }}
      >
        <SetSettingsFields
          value={value}
          onChange={setValue}
          idPrefix="edit-set"
        />
        <div className={s.actions}>
          <button
            type="submit"
            className="primary-button"
            disabled={update.isPending || archived}
          >
            {update.isSuccess && !update.isPending ? "تم الحفظ" : "احفظ"}
          </button>
        </div>
      </form>

      <div className={s.form}>
        <strong>الوصول</strong>
        <p className={s.note}>
          التعطيل يوقف وصول كل الطلاب فورًا دون حذف أي شيء، وتقدر تعيد التفعيل
          متى شئت. الأرشفة نهائية.
        </p>
        {error ? (
          <p className={s.error} role="alert">
            {error.message}
          </p>
        ) : null}
        <div className={s.actions}>
          {set.status === "published" && (
            <button
              type="button"
              className="secondary-button"
              disabled={disable.isPending}
              onClick={() => disable.mutate({ setId })}
            >
              عطّل الوصول الآن
            </button>
          )}
          {set.status === "disabled" && (
            <button
              type="button"
              className="primary-button"
              disabled={enable.isPending}
              onClick={() => enable.mutate({ setId })}
            >
              أعد التفعيل
            </button>
          )}
          {!archived &&
            (confirmArchive ? (
              <>
                <button
                  type="button"
                  className="account-danger-button"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate({ setId })}
                >
                  تأكيد الأرشفة النهائية
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirmArchive(false)}
                >
                  تراجع
                </button>
              </>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmArchive(true)}
              >
                أرشف المجموعة
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

const QUICK_COUNTS = [10, 50, 100, 200, 500];

function downloadCsv(codes: string[], batchId: string) {
  const csv = "code\n" + codes.join("\n") + "\n";
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `nirolearn-codes-${batchId.slice(0, 8)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CodesTab({ setId, published }: { setId: string; published: boolean }) {
  const utils = trpc.useUtils();
  const [count, setCount] = useState(50);
  const [status, setStatus] = useState<"" | "unused" | "claimed" | "revoked">(
    ""
  );
  const [search, setSearch] = useState("");
  const [fresh, setFresh] = useState<{
    batchId: string;
    codes: string[];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const generate = trpc.doctor.codes.generate.useMutation({
    onSuccess: result => {
      setFresh(result);
      setCopied(false);
      void utils.doctor.codes.list.invalidate({ setId });
    },
  });
  const revoke = trpc.doctor.codes.revoke.useMutation({
    onSuccess: () => utils.doctor.codes.list.invalidate({ setId }),
  });
  const list = trpc.doctor.codes.list.useQuery({
    setId,
    status: status || undefined,
    search: search || undefined,
  });

  return (
    <div className={s.section}>
      {published ? (
        <form
          className={s.form}
          onSubmit={event => {
            event.preventDefault();
            generate.mutate({ setId, count });
          }}
        >
          <label className={s.field} htmlFor="code-count">
            عدد الأكواد <small>(كل كود لطالب واحد، حتى 500 في المرة)</small>
            <input
              id="code-count"
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={event =>
                setCount(
                  Math.max(1, Math.min(500, Number(event.target.value) || 1))
                )
              }
            />
          </label>
          <div className={s.choice}>
            {QUICK_COUNTS.map(n => (
              <button
                key={n}
                type="button"
                className="secondary-button"
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {generate.error ? (
            <p className={s.error} role="alert">
              {generate.error.message}
            </p>
          ) : null}
          <div className={s.actions}>
            <button
              type="submit"
              className="nl-marker-button"
              disabled={generate.isPending}
            >
              {generate.isPending ? "جاري التوليد..." : `ولّد ${count} كود`}
            </button>
          </div>
        </form>
      ) : (
        <div className={s.empty}>
          <strong>توليد الأكواد متاح بعد نشر المجموعة.</strong>
        </div>
      )}

      {fresh && (
        <div className={s.freshCodes} role="status">
          <strong>
            {fresh.codes.length} كود جديد — احفظها الآن، لن تظهر كاملة مرة أخرى.
          </strong>
          <span className={s.note}>
            ملف الأكواد حساس: من يملك الكود يستطيع الدخول. شاركه مع طلابك فقط.
          </span>
          <div className={s.actions}>
            <button
              type="button"
              className="primary-button"
              onClick={() => downloadCsv(fresh.codes, fresh.batchId)}
            >
              <Download size={16} aria-hidden="true" /> تنزيل CSV
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(fresh.codes.join("\n"))
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <Copy size={16} aria-hidden="true" />{" "}
              {copied ? "تم النسخ" : "نسخ الكل"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setFresh(null)}
            >
              حفظتها، أخفِها
            </button>
          </div>
          <ul className={`${s.codeGrid} ${s.code}`}>
            {fresh.codes.map(code => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={s.filters}>
        <select
          aria-label="حالة الكود"
          value={status}
          onChange={event => setStatus(event.target.value as typeof status)}
        >
          <option value="">الكل</option>
          <option value="unused">غير مستخدم</option>
          <option value="claimed">مستخدم</option>
          <option value="revoked">ملغى</option>
        </select>
        <input
          aria-label="بحث بآخر 4 أحرف أو اسم المستخدم"
          placeholder="آخر 4 أحرف أو @اسم"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>

      {list.data?.length ? (
        <ul className={s.list}>
          {list.data.map(code => (
            <li key={code.id} className={s.row}>
              <span className={s.rowMain}>
                <span className={`${s.rowTitle} ${s.code}`}>
                  NL-····-····-{code.hint}
                </span>
                <span className={s.rowMeta}>
                  {code.status === "claimed"
                    ? `مستخدم · ${code.studentUsername ? "@" + code.studentUsername : (code.studentName ?? "طالب")} · ${formatDateTime(code.claimedAt)}`
                    : code.status === "revoked"
                      ? `ملغى · ${formatDateTime(code.revokedAt)}`
                      : `غير مستخدم · ${formatDateTime(code.createdAt)}`}
                </span>
              </span>
              {code.status === "unused" && (
                <span className={s.rowActions}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ codeId: code.id })}
                  >
                    إلغاء
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.note}>
          {list.isLoading ? "جاري التحميل..." : "لا توجد أكواد بهذا الفلتر."}
        </p>
      )}
    </div>
  );
}

function StudentsTab({ setId }: { setId: string }) {
  const utils = trpc.useUtils();
  const students = trpc.doctor.students.list.useQuery({ setId });
  const [confirming, setConfirming] = useState<string | null>(null);
  const revoke = trpc.doctor.students.revoke.useMutation({
    onSuccess: () => {
      setConfirming(null);
      void utils.doctor.students.list.invalidate({ setId });
    },
  });

  if (students.isLoading) return <p className={s.note}>جاري التحميل...</p>;
  if (!students.data?.length) {
    return (
      <div className={s.empty}>
        <strong>لم يفعّل أي طالب كودًا بعد.</strong>
      </div>
    );
  }
  return (
    <ul className={s.list}>
      {students.data.map(student => (
        <li key={student.entitlementId} className={s.row}>
          <span className={s.rowMain}>
            <span className={s.rowTitle}>
              {student.name || "طالب"}
              {student.username ? ` · @${student.username}` : ""}
            </span>
            <span className={s.rowMeta}>
              {student.status === "active" ? "مفعّل" : "مسحوب"} ·{" "}
              {formatDateTime(student.grantedAt)}
              {student.codeHint ? ` · كود ···${student.codeHint}` : ""}
            </span>
          </span>
          {student.status === "active" && (
            <span className={s.rowActions}>
              {confirming === student.entitlementId ? (
                <>
                  <button
                    type="button"
                    className="account-danger-button"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate({ entitlementId: student.entitlementId })
                    }
                  >
                    تأكيد السحب
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirming(null)}
                  >
                    تراجع
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirming(student.entitlementId)}
                >
                  اسحب الوصول
                </button>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ setId }: { setId: string }) {
  const audit = trpc.doctor.audit.useQuery({ setId });
  if (audit.isLoading) return <p className={s.note}>جاري التحميل...</p>;
  return (
    <ul className={s.list}>
      {(audit.data ?? []).map(event => (
        <li key={event.id} className={s.row}>
          <span className={s.rowMain}>
            <span className={s.rowTitle}>
              {AUDIT_EVENT_LABELS[event.event] ?? event.event}
              {typeof event.meta?.count === "number"
                ? ` (${event.meta.count})`
                : ""}
            </span>
            <span className={s.rowMeta}>
              {event.actorUsername
                ? `@${event.actorUsername}`
                : (event.actorName ?? "—")}{" "}
              · {formatDateTime(event.createdAt)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
