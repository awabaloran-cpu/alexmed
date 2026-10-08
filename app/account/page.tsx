"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  AtSign,
  BarChart3,
  BookOpen,
  ChevronLeft,
  CreditCard,
  FileText,
  GraduationCap,
  LifeBuoy,
  LogOut,
  Send,
  Settings,
  Stethoscope,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { formatPhoneForDisplay } from "@/lib/phone";
import PlanSummaryCard from "@/components/billing/PlanSummaryCard";
import { UsernameCard } from "@/components/sharing/UsernameCard";
import DeleteAccountSection from "@/components/DeleteAccountSection";
import s from "./account.module.css";

// Real route for Bottom Nav's "👤 حسابي". Organised like a platform
// settings screen: who you are and your study numbers first, then grouped
// lists — rows that expand in place (profile, username, plan) and rows that
// open a page. Everything the old page offered is still here; only the
// arrangement changed. لوحة اليوم / المراجعة اليومية / اختباراتي / نقاط
// الضعف stay off this menu at the owner's request (2026-09-24).
// Since 2026-09-29: "الإدارة" (مكتبة الأدمن, لوحة الأدمن, لوحة الدكتور) is
// shown only to admins / approved doctors — and each of those routes is
// also gated on the server (app/admin, app/materials, app/doctor layouts),
// so hiding the row is never the only protection. حذف الحساب is a quiet
// link inside الملف الدراسي, confirmed by typing «حذف».

type LinkRow = { href: string; label: string; icon: LucideIcon };

const STUDY_LINKS: LinkRow[] = [
  { href: "/?view=library", label: "ملفات الأسئلة", icon: BookOpen },
  { href: "/books/stats", label: "إحصائياتي", icon: BarChart3 },
  { href: "/shared", label: "مشترك معي", icon: Users },
];

const HELP_LINKS: LinkRow[] = [
  { href: "/privacy", label: "سياسة الخصوصية", icon: ShieldCheck },
  { href: "/terms", label: "سياسة الاستخدام", icon: FileText },
  { href: "/contact", label: "تواصل معنا", icon: LifeBuoy },
];

function doctorApplicationLabel(
  data:
    | {
        approved: boolean;
        profile: { status: string } | null;
      }
    | undefined
) {
  switch (data?.profile?.status) {
    case "pending":
      return "طلب الدكتور قيد المراجعة";
    case "rejected":
      return "طلب الدكتور لم يُقبل";
    case "suspended":
      return "صلاحيات الدكتور موقوفة";
    default:
      return "انضم كدكتور";
  }
}

export default function AccountPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const name = session?.user?.name || session?.user?.email || "حسابي";
  const initial = name.trim().charAt(0).toUpperCase() || "؟";

  const profileQuery = trpc.auth.profile.useQuery();
  const statsQuery = trpc.books.stats.useQuery();
  const planQuery = trpc.billing.mine.useQuery();
  const sharingQuery = trpc.sharing.profile.useQuery();
  // 🔒 Doctor capability (Protected Doctor Question Sets) — only asked for
  // while the feature is on.
  const doctorSetsOn = trpc.questionSets.enabled.useQuery().data === true;
  const doctorQuery = trpc.doctor.status.useQuery(undefined, {
    enabled: doctorSetsOn,
  });
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => profileQuery.refetch(),
  });

  // /account#delete-account (privacy policy, terms): open الملف الدراسي,
  // where the delete link lives.
  const profileRowRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.location.hash === "#delete-account" && profileRowRef.current) {
      profileRowRef.current.open = true;
    }
  }, []);

  const [academicYear, setAcademicYear] = useState("");
  const [specialty, setSpecialty] = useState("");
  useEffect(() => {
    if (!profileQuery.data) return;
    setAcademicYear(profileQuery.data.academicYear ?? "");
    setSpecialty(profileQuery.data.specialty ?? "");
  }, [profileQuery.data]);

  const profile = profileQuery.data;
  const contact =
    session?.user?.email ||
    (profile?.phone ? formatPhoneForDisplay(profile.phone) : "");
  const studyLine = [profile?.specialty, profile?.academicYear]
    .filter(Boolean)
    .join("، ");
  const username = sharingQuery.data?.username;
  const stats = statsQuery.data;
  const isDoctor = doctorSetsOn && doctorQuery.data?.approved === true;

  return (
    <section className="upload-view">
      <div className={s.page}>
        <h1 className="sr-only">حسابي</h1>

        {/* ── Who you are + your study numbers ─────────────────────── */}
        <div className={s.identity}>
          <div className={s.who}>
            <div className={s.avatar} aria-hidden="true">
              {initial}
            </div>
            <div className={s.whoText}>
              <p className={s.name}>{name}</p>
              {contact ? (
                <p
                  className={s.contact}
                  dir="ltr"
                  style={{ textAlign: "right" }}
                >
                  {contact}
                </p>
              ) : null}
              <div className={s.badges}>
                {planQuery.data ? (
                  <span className={`${s.badge} ${s.badgeMarked}`}>
                    باقة {planQuery.data.plan.name}
                  </span>
                ) : null}
                {isAdmin ? <span className={s.badge}>أدمن</span> : null}
                {studyLine ? (
                  <span className={s.badge}>{studyLine}</span>
                ) : null}
              </div>
            </div>
          </div>

          {stats ? (
            <>
              <dl className={s.stats}>
                <Stat label="الملفات" value={stats.fileCount} />
                <Stat label="البطاقات" value={stats.cardCount} />
                <Stat label="بطاقات تمت مراجعتها" value={stats.cardsReviewed} />
                <Stat
                  label="أسئلة مُجابة"
                  value={stats.quizQuestionsAnsweredCount}
                />
                <Stat
                  label="متوسط الدرجة"
                  value={`${stats.accuracyPercent}%`}
                />
              </dl>
              <Link href="/books/stats" className={s.statsLink}>
                عرض إحصائياتي كاملة
              </Link>
            </>
          ) : null}
        </div>

        {/* ── Account settings (expand in place) ───────────────────── */}
        <Group title="الحساب">
          <li>
            <details className={s.expand} ref={profileRowRef}>
              <RowSummary
                icon={UserRound}
                label="الملف الدراسي"
                value={studyLine || "أضف تخصصك وسنتك"}
              />
              <div className={s.panel}>
                <div className={s.fields}>
                  <label className={s.field}>
                    السنة الدراسية
                    <input
                      value={academicYear}
                      onChange={event => setAcademicYear(event.target.value)}
                      placeholder="مثال: السنة الثالثة"
                    />
                  </label>
                  <label className={s.field}>
                    التخصص
                    <input
                      value={specialty}
                      onChange={event => setSpecialty(event.target.value)}
                      placeholder="مثال: طب بشري"
                    />
                  </label>
                </div>
                <div className={s.formActions}>
                  <button
                    type="button"
                    className={s.save}
                    disabled={updateProfile.isPending}
                    onClick={() =>
                      updateProfile.mutate({
                        academicYear: academicYear.trim() || null,
                        specialty: specialty.trim() || null,
                      })
                    }
                  >
                    حفظ
                  </button>
                  {updateProfile.isSuccess ? (
                    <span className={s.saved} role="status">
                      تم الحفظ.
                    </span>
                  ) : null}
                </div>
                {profile ? <DeleteAccountSection /> : null}
              </div>
            </details>
          </li>
          <li>
            <details className={s.expand}>
              <RowSummary
                icon={AtSign}
                label="اسم المستخدم للمشاركة"
                value={username ? `@${username}` : "لم تختره بعد"}
                valueDir={username ? "ltr" : undefined}
              />
              <div className={`${s.panel} ${s.nested}`}>
                <UsernameCard compact />
              </div>
            </details>
          </li>
          <li>
            <details className={s.expand}>
              <RowSummary
                icon={CreditCard}
                label="الباقة والاستخدام"
                value={planQuery.data?.plan.name ?? ""}
              />
              <div className={`${s.panel} ${s.nested}`}>
                <PlanSummaryCard />
              </div>
            </details>
          </li>
          <TelegramRow />
        </Group>

        {/* ── Pages ─────────────────────────────────────────────────── */}
        <Group title="دراستي">
          {STUDY_LINKS.map(link => (
            <li key={link.href}>
              <LinkRowItem {...link} />
            </li>
          ))}
        </Group>

        {isAdmin || isDoctor ? (
          <Group title="الإدارة">
            {isAdmin ? (
              <li>
                <LinkRowItem
                  href="/materials"
                  label="مكتبة الأدمن"
                  icon={GraduationCap}
                />
              </li>
            ) : null}
            {isDoctor ? (
              <li>
                <LinkRowItem
                  href="/doctor"
                  label="لوحة الدكتور"
                  icon={Stethoscope}
                />
              </li>
            ) : null}
            {isAdmin ? (
              <li>
                <LinkRowItem
                  href="/admin"
                  label="لوحة تحكم الأدمن"
                  icon={Settings}
                />
              </li>
            ) : null}
          </Group>
        ) : null}

        <Group title="المساعدة">
          {HELP_LINKS.map(link => (
            <li key={link.href}>
              <LinkRowItem {...link} />
            </li>
          ))}
        </Group>

        <ul className={s.list}>
          <li>
            <button
              type="button"
              className={`${s.row} ${s.signOut}`}
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={18} aria-hidden="true" />
              تسجيل الخروج
            </button>
          </li>
        </ul>

        {/* Doctors apply here; the dashboard row above appears once approved. */}
        {doctorSetsOn && doctorQuery.data && !isDoctor ? (
          <Link href="/account/doctor" className={s.quietLink}>
            {doctorApplicationLabel(doctorQuery.data)}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={s.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ✈️ Connect / disconnect the Telegram bot (lib/telegram). Renders nothing
// while the gateway is off, so the page is unchanged until it is configured.
function TelegramRow() {
  const utils = trpc.useUtils();
  const status = trpc.telegram.status.useQuery(undefined, { retry: false });
  const createLink = trpc.telegram.createLink.useMutation({
    // The bot receives the one-time code in the link itself.
    onSuccess: data => window.location.assign(data.url),
  });
  const unlink = trpc.telegram.unlink.useMutation({
    onSuccess: () => utils.telegram.status.invalidate(),
  });
  if (!status.data?.available) return null;
  const { linked, isGuest } = status.data;
  const error = createLink.error ?? unlink.error;

  return (
    <li>
      <details className={s.expand}>
        <RowSummary
          icon={Send}
          label="Telegram"
          value={linked ? "مربوط بحسابك" : "غير مربوط"}
        />
        <div className={s.panel}>
          <p className={s.saved}>
            {isGuest
              ? "تستخدم NiroLearn كضيف من Telegram. أنشئ حسابك لتحتفظ بملفاتك وترفع ملفات أخرى."
              : linked
                ? "الملفات التي ترسلها إلى البوت تُضاف إلى حسابك هذا."
                : "اربط Telegram لترسل ملفاتك إلى البوت وتجدها هنا."}
          </p>
          <div className={s.formActions}>
            {isGuest ? (
              <Link href="/register" className={s.save}>
                أنشئ حسابك
              </Link>
            ) : linked ? (
              <button
                type="button"
                className={s.save}
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}
              >
                فصل Telegram
              </button>
            ) : (
              <button
                type="button"
                className={s.save}
                disabled={createLink.isPending}
                onClick={() => createLink.mutate()}
              >
                ربط Telegram
              </button>
            )}
            {error ? (
              <span className={s.saved} role="alert">
                {error.message}
              </span>
            ) : null}
          </div>
        </div>
      </details>
    </li>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = `account-group-${title.replace(/\s+/g, "-")}`;
  return (
    <section className={s.group} aria-labelledby={id}>
      <h2 id={id} className={s.groupTitle}>
        {title}
      </h2>
      <ul className={s.list}>{children}</ul>
    </section>
  );
}

function RowSummary({
  icon: Icon,
  label,
  value,
  valueDir,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueDir?: "ltr";
}) {
  return (
    <summary className={s.row}>
      <span className={s.rowIcon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className={s.rowText}>
        <span className={s.rowLabel}>{label}</span>
        {value ? (
          <span className={s.rowValue}>
            {valueDir ? <bdi dir={valueDir}>{value}</bdi> : value}
          </span>
        ) : null}
      </span>
      <ChevronLeft size={18} className={s.chevron} aria-hidden="true" />
    </summary>
  );
}

function LinkRowItem({ href, label, icon: Icon }: LinkRow) {
  return (
    <Link href={href} className={s.row}>
      <span className={s.rowIcon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className={s.rowLabel}>{label}</span>
      <ChevronLeft size={18} className={s.chevron} aria-hidden="true" />
    </Link>
  );
}
