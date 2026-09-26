import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for the public legal pages (/privacy, /terms): readable
// Arabic long-form layout with a table of contents. Server component, no
// login needed — Google Play and new visitors must be able to open these.
export const LEGAL_APP_NAME = "NiroLearn";
export const LEGAL_CONTACT_EMAIL = "awabalomran2001@gmail.com";
export const LEGAL_UPDATED_AT = "26 سبتمبر 2026";

export type LegalSection = { id: string; title: string; body: ReactNode };

export default function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main className="legal-page" dir="rtl">
      <header className="legal-hero">
        <Link href="/" className="legal-brand">
          {LEGAL_APP_NAME}
        </Link>
        <h1>{title}</h1>
        <p className="legal-updated">آخر تحديث: {LEGAL_UPDATED_AT}</p>
        <div className="legal-intro">{intro}</div>
      </header>

      <nav className="legal-toc" aria-label="المحتويات">
        <strong>المحتويات</strong>
        <ol>
          {sections.map(section => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section, index) => (
        <section key={section.id} id={section.id} className="legal-section">
          <h2>
            <span>{index + 1}.</span> {section.title}
          </h2>
          {section.body}
        </section>
      ))}

      <footer className="legal-footer">
        <p>
          للتواصل:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} dir="ltr">
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
        <p>
          <Link href="/privacy">سياسة الخصوصية</Link> ·{" "}
          <Link href="/terms">سياسة الاستخدام</Link> ·{" "}
          <Link href="/login">تسجيل الدخول</Link>
        </p>
      </footer>
    </main>
  );
}
