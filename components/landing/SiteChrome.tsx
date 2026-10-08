// Header, footer and page shell shared by every public marketing page
// (the landing page, the tool pages and the study guide). Server
// components; the nav links are real pages, so they double as the site's
// internal-link structure for crawlers.
import Link from "next/link";
import NiroSpark from "@/components/niro/NiroSpark";
import {
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  SOLVE_QUESTIONS_PATH,
  SITE_NAME,
  TOOL_PAGES,
  type ToolPath,
} from "@/lib/site";
import type { LearnCategory } from "@/content/learn/articles";
import s from "./landing.module.css";

export function MarketingPage({
  current,
  children,
}: {
  current?: ToolPath | "/" | "/learn" | LearnCategory;
  children: React.ReactNode;
}) {
  return (
    <div className={s.page}>
      <a className={s.skip} href="#main">
        انتقل إلى المحتوى
      </a>
      <SiteHeader current={current} />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader({ current }: { current?: string }) {
  return (
    <header className={s.header}>
      <div className={s.bar}>
        <Link
          href="/"
          className={s.brand}
          aria-label={`${SITE_NAME}، الصفحة الرئيسية`}
        >
          <NiroSpark size={22} />
          <span>{SITE_NAME}</span>
        </Link>
        <nav aria-label="أدوات NiroLearn" className={s.nav}>
          <Link
            href="/learn"
            aria-current={current === "/learn" ? "page" : undefined}
          >
            Learn
          </Link>
          {TOOL_PAGES.map(page => (
            <Link
              key={page.href}
              href={page.href}
              aria-current={current === page.href ? "page" : undefined}
            >
              {page.label}
            </Link>
          ))}
          <Link href="/pricing">الأسعار</Link>
        </nav>
        <div className={s.headerActions}>
          <Link href="/login" className={s.linkButton}>
            تسجيل الدخول
          </Link>
          <Link href="/register" className={s.primarySmall}>
            ابدأ مجانًا
          </Link>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.footerInner}>
        <div className={s.footerBrand}>
          <span className={s.brand}>
            <NiroSpark size={20} />
            <span>{SITE_NAME}</span>
          </span>
          <p>
            منصة مذاكرة عربية بالذكاء الاصطناعي تحوّل ملفاتك إلى مذاكرة منظمة.
          </p>
        </div>
        <div className={s.footerCols}>
          <nav aria-label="الأدوات" className={s.footerNav}>
            <h2 className={s.footerHeading}>الأدوات</h2>
            {TOOL_PAGES.map(page => (
              <Link key={page.href} href={page.href}>
                {page.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="روابط الموقع" className={s.footerNav}>
            <h2 className={s.footerHeading}>NiroLearn</h2>
            <Link href="/">الرئيسية</Link>
            <Link href="/learn">Learn</Link>
            <Link href={BOT_PAGE_PATH}>بوت Telegram</Link>
            <Link href={PAST_QUESTIONS_PATH}>أسئلة سنوات سابقة</Link>
            <Link href={SOLVE_QUESTIONS_PATH}>حل أسئلة بالذكاء الاصطناعي</Link>
            <Link href="/pricing">الأسعار</Link>
            <Link href="/register">إنشاء حساب</Link>
            <Link href="/login">تسجيل الدخول</Link>
            <Link href="/contact">تواصل معنا</Link>
          </nav>
          <nav aria-label="السياسات" className={s.footerNav}>
            <h2 className={s.footerHeading}>السياسات</h2>
            <Link href="/privacy">سياسة الخصوصية</Link>
            <Link href="/terms">سياسة الاستخدام</Link>
          </nav>
        </div>
      </div>
      <p className={s.copyright}>
        © {new Date().getFullYear()} {SITE_NAME}
      </p>
    </footer>
  );
}
