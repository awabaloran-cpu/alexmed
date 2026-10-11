"use client";

import { Loader2, RotateCw } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/router";
import { trpc } from "@/lib/trpc-client";
import s from "./monitor.module.css";

const POLL_MS = 30_000;

const pct = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

function Figure({
  label,
  value,
  note,
  alarm = false,
}: {
  label: string;
  value: string | number;
  note?: string;
  alarm?: boolean;
}) {
  return (
    <div className={`${s.figure} ${alarm ? s.alarm : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function Reasons({
  title,
  rows,
}: {
  title: string;
  rows: { reason: string; count: number }[];
}) {
  return (
    <div className={s.block}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className={s.none}>لا إخفاقات مسجّلة في آخر 7 أيام.</p>
      ) : (
        <ol className={s.reasons}>
          {rows.map(row => (
            <li key={row.reason}>
              <span dir="auto">{row.reason}</span>
              <b>{row.count}</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// 📊 What the system is doing right now: what is being prepared, what has
// stopped, why things failed, and the rooms. Read every half minute.
// Numbers and short reasons only — never a file's text or a student's name
// (lib/db-admin-monitor.ts).
export default function AdminMonitorPage() {
  const monitor = trpc.adminMonitor.overview.useQuery(undefined, {
    refetchInterval: POLL_MS,
  });

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> لوحة تحكم الأدمن
          </div>
          <h1>المراقبة</h1>
          <p>
            ما يُجهَّز الآن، ما توقف، ولماذا فشل. أرقام وأسباب مختصرة فقط، بلا
            نصوص ملفات ولا أسماء طلاب.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={monitor.isFetching}
          onClick={() => monitor.refetch()}
        >
          <RotateCw size={15} aria-hidden="true" /> تحديث
        </button>
      </div>

      {monitor.isLoading ? (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
        </div>
      ) : monitor.error || !monitor.data ? (
        <div className="inline-alert error wide" role="alert">
          تعذّر تحميل الأرقام. {monitor.error?.message}
        </div>
      ) : (
        <Board data={monitor.data} />
      )}
    </section>
  );
}

type Data = inferRouterOutputs<AppRouter>["adminMonitor"]["overview"];

function Board({ data }: { data: Data }) {
  const { files, chapters, questions, sets, rooms, reasons, stuck } = data;
  return (
    <div className={s.board}>
      <p className={s.at}>
        آخر قراءة:{" "}
        {new Date(data.at).toLocaleTimeString("ar-u-nu-latn", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
        {" · "}تتحدّث كل 30 ثانية
      </p>

      <h2>الملفات</h2>
      <dl className={s.figures}>
        <Figure label="تُقرأ الآن" value={files.readingNow} />
        <Figure
          label="متوقفة أثناء القراءة"
          value={files.stuckReading}
          note="لم يتحرك شيء منذ 20 دقيقة"
          alarm={files.stuckReading > 0}
        />
        <Figure label="اكتملت قراءتها (24 ساعة)" value={files.done24h} />
        <Figure
          label="فشلت (24 ساعة)"
          value={files.failed24h}
          note={`نسبة الفشل ${pct(files.failureRate24h)}`}
          alarm={files.failed24h > 0}
        />
        <Figure
          label="متوسط زمن ملف الأسئلة"
          value={
            files.avgReadMinutes === null ? "—" : `${files.avgReadMinutes} د`
          }
          note="من الرفع حتى آخر تحديث، آخر 24 ساعة"
        />
      </dl>

      <h2>شرح الأسئلة والفصول</h2>
      <dl className={s.figures}>
        <Figure label="أسئلة تنتظر الشرح" value={questions.waiting} />
        <Figure label="يُكتب شرحها الآن" value={questions.writing} />
        <Figure
          label="ملفات توقف شرحها"
          value={questions.stalledFiles}
          note="أسئلة منتظرة ولا شيء يتحرك"
          alarm={questions.stalledFiles > 0}
        />
        <Figure
          label="أسئلة فشل شرحها (7 أيام)"
          value={questions.failed7d}
          note="استنفدت محاولاتها"
          alarm={questions.failed7d > 0}
        />
        <Figure label="فصول تنتظر التحليل" value={chapters.waiting} />
        <Figure label="فصول تُحلَّل الآن" value={chapters.analyzing} />
        <Figure
          label="فصول فشل تحليلها"
          value={chapters.failed}
          alarm={chapters.failed > 0}
        />
      </dl>

      <h2>مجموعات الدكاترة</h2>
      <dl className={s.figures}>
        <Figure label="منشورة" value={sets.published} />
        <Figure label="مسودات لم تُنشر" value={sets.drafts} />
        <Figure label="مسودات تُجهَّز الآن" value={sets.draftsPreparing} />
        <Figure
          label="أسئلة تحتاج مراجعة الدكتور"
          value={sets.needsReview}
          note="في المسودات"
        />
      </dl>

      <h2>الغرف</h2>
      <dl className={s.figures}>
        <Figure label="غرف نشطة" value={rooms.active} />
        <Figure label="حاضرون الآن" value={rooms.present} />
        <Figure label="انتهت (24 ساعة)" value={rooms.ended24h} />
        <Figure
          label="أُغلقت لأنها فرغت"
          value={rooms.endedEmpty24h}
          note="من المنتهية في 24 ساعة"
        />
      </dl>

      <h2>ملفات متوقفة</h2>
      {stuck.length === 0 ? (
        <p className={s.none}>لا ملفات متوقفة الآن.</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>الملف</th>
                <th>النوع</th>
                <th>أين توقف</th>
                <th>منذ</th>
                <th>أسئلة منتظرة</th>
              </tr>
            </thead>
            <tbody>
              {stuck.map(file => (
                <tr key={`${file.id}-${file.stage}`}>
                  <td>
                    <span dir="auto">{file.fileName}</span>
                    <small dir="ltr">{file.id.slice(0, 8)}</small>
                  </td>
                  <td>{file.kind === "book" ? "كتاب" : "ملف أسئلة"}</td>
                  <td>
                    {file.stage === "reading" ? "قراءة الملف" : "شرح الأسئلة"}
                  </td>
                  <td dir="ltr">
                    {file.minutes >= 120
                      ? `${Math.round(file.minutes / 60)} h`
                      : `${file.minutes} min`}
                  </td>
                  <td>{file.stage === "explaining" ? file.waiting : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>أكثر أسباب الفشل (7 أيام)</h2>
      <div className={s.blocks}>
        <Reasons title="قراءة الملفات" rows={reasons.files} />
        <Reasons title="شرح الأسئلة" rows={reasons.questions} />
        <Reasons title="صور الصفحات" rows={reasons.pages} />
      </div>

      <p className={s.none}>
        استهلاك الذكاء الاصطناعي وتكلفته غير معروضين: لا يُخزَّنان في قاعدة
        البيانات، وهما في سجلات الخادم ولوحة المزوّد فقط.
      </p>
    </div>
  );
}
