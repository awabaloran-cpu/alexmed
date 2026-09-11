"use client";

import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// Developer-facing Jobs monitoring page (Phase 0 requirement) — admin-only,
// gated both here (app/admin/layout.tsx redirects non-admins before this
// ever renders) and again at the tRPC layer (adminJobsRouter uses
// adminProcedure). Deliberately shows only identifiers/status/counts/
// truncated errors — never a file's full text, and never an S3 key or
// signed URL (see lib/db-admin-jobs.ts's header comment for the exact
// contract this page's queries are held to).
const POLL_INTERVAL_MS = 5000;

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const isFailure = status === "failed" || status === "partial_failed";
  return (
    <span
      className="badge"
      style={isFailure ? { color: "#c0392b", fontWeight: 600 } : undefined}
    >
      {status}
    </span>
  );
}

export default function AdminJobsPage() {
  const booksQuery = trpc.adminJobs.books.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
  });
  const mirrorQuery = trpc.adminJobs.mirrorJobs.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
  });
  const materialsQuery = trpc.adminJobs.adminMaterialJobs.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
  });

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> لوحة تحكم الأدمن
          </div>
          <h1>حالة المهام (Jobs)</h1>
          <p>عرض للمطورين فقط — بدون نص كامل للكتب أو روابط تخزين.</p>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>كتبي — استخراج وتحليل الفصول</h2>
      {booksQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
        </div>
      ) : !booksQuery.data?.length ? (
        <div className="empty-state">
          <h3>لا توجد كتب بعد</h3>
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 24 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>الملف</th>
                <th>الحالة</th>
                <th>محاولات الاستخراج</th>
                <th>الفصول (ناجح/فاشل/كل)</th>
                <th>الصفحات (ناجح/فاشل/كل)</th>
                <th>آخر تحديث</th>
                <th>خطأ (مختصر)</th>
              </tr>
            </thead>
            <tbody>
              {booksQuery.data.map(job => (
                <tr key={job.id}>
                  <td title={job.id}>{job.fileName}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>{job.extractionAttemptCount}</td>
                  <td>
                    {job.chapters.complete}/{job.chapters.failed}/
                    {job.chapters.total}
                  </td>
                  <td>
                    {job.pages.complete}/{job.pages.failed}/{job.pages.total}
                  </td>
                  <td>{formatDateTime(job.updatedAt)}</td>
                  <td>{job.extractionError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>مِرآة — دفعات التوليد</h2>
      {mirrorQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
        </div>
      ) : !mirrorQuery.data?.length ? (
        <div className="empty-state">
          <h3>لا توجد مهام بعد</h3>
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 24 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>الملف</th>
                <th>الحالة</th>
                <th>محاولات الاستخراج</th>
                <th>الدفعات (ناجح/فاشل/كل)</th>
                <th>آخر تحديث</th>
                <th>خطأ (مختصر)</th>
              </tr>
            </thead>
            <tbody>
              {mirrorQuery.data.map(job => (
                <tr key={job.id}>
                  <td title={job.id}>{job.fileName}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>{job.extractionAttemptCount}</td>
                  <td>
                    {job.batches.complete}/{job.batches.failed}/
                    {job.batches.total}
                  </td>
                  <td>{formatDateTime(job.updatedAt)}</td>
                  <td>{job.extractionError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>مكتبة الأدمن — دفعات التوليد</h2>
      {materialsQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
        </div>
      ) : !materialsQuery.data?.length ? (
        <div className="empty-state">
          <h3>لا توجد مواد بعد</h3>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>العنوان</th>
                <th>الحالة</th>
                <th>محاولات الاستخراج</th>
                <th>الدفعات (ناجح/فاشل/كل)</th>
                <th>آخر تحديث</th>
                <th>خطأ (مختصر)</th>
              </tr>
            </thead>
            <tbody>
              {materialsQuery.data.map(job => (
                <tr key={job.id}>
                  <td title={job.id}>{job.title}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>{job.extractionAttemptCount}</td>
                  <td>
                    {job.batches.complete}/{job.batches.failed}/
                    {job.batches.total}
                  </td>
                  <td>{formatDateTime(job.updatedAt)}</td>
                  <td>{job.extractionError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
