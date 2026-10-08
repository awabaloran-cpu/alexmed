// Building blocks for the public tool pages and the study guide. Server
// components; the before/after figure and flip card are the only client
// islands and are passed in by the pages.
import Link from "next/link";
import NiroCharacter from "@/components/niro/NiroCharacter";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/LegalPage";
import {
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  SITE_ENTITY_DESCRIPTION_AR,
  SITE_ENTITY_IDS,
  SITE_NAME,
  SITE_URL,
  TOOL_PAGES,
  type ToolPath,
} from "@/lib/site";
import s from "./landing.module.css";

export type FaqItem = { q: string; a: string };

export function ToolHero({
  title,
  lede,
  figure,
}: {
  title: string;
  lede: React.ReactNode;
  figure: React.ReactNode;
}) {
  return (
    <section className={s.toolHero} aria-labelledby="page-title">
      <div className={s.toolHeroCopy}>
        <h1 id="page-title" className={s.heroTitle}>
          {title}
        </h1>
        <div className={s.heroLede}>{lede}</div>
        <div className={s.ctaRow}>
          <Link href="/register" className={s.primary}>
            ابدأ مجانًا
          </Link>
          <Link href="/pricing" className={s.secondary}>
            الأسعار
          </Link>
        </div>
        <p className={s.fineprint}>حساب مجاني برقم هاتفك، دون بطاقة دفع.</p>
      </div>
      <div className={s.toolHeroFigure}>{figure}</div>
    </section>
  );
}

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-title`}>
      <div className={s.sectionHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        {intro ? <p>{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function FaqSection({ items }: { items: readonly FaqItem[] }) {
  return (
    <Section id="faq" title="أسئلة شائعة">
      <div className={s.faq}>
        {items.map(item => (
          <details key={item.q} className={s.faqItem}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function CtaBand({ title, text }: { title: string; text: string }) {
  return (
    <section className={s.cta} aria-labelledby="cta-title">
      <NiroCharacter
        expression="victory"
        size={120}
        animated={false}
        className={s.ctaNiro}
      />
      <div>
        <h2 id="cta-title">{title}</h2>
        <p>{text}</p>
        <Link href="/register" className={s.primary}>
          ابدأ مجانًا
        </Link>
      </div>
    </section>
  );
}

const RELATED_BLURB: Record<ToolPath, string> = {
  "/pdf-summary": "ملخص منظم لكل جزء من الكتاب أو المحاضرة.",
  "/flashcards": "بطاقات سؤال وجواب تعود إليك في موعدها.",
  "/mind-map": "خريطة ذهنية لكل جزء بمفاهيمه وأهم نقاطه.",
  "/how-to-study": "طريقة مذاكرة عملية لملف كبير قبل الامتحان.",
};

// `current` is left out by a page that is not itself one of the tools.
export function RelatedPages({ current }: { current?: ToolPath }) {
  return (
    <Section id="related" title="أدوات أخرى من الملف نفسه">
      <ul className={s.related}>
        {TOOL_PAGES.filter(page => page.href !== current).map(page => (
          <li key={page.href}>
            <Link href={page.href}>{page.label}</Link>
            <p>{RELATED_BLURB[page.href]}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// "<" written as its JSON escape so no string value can close the tag.
const LT_ESCAPE = "\\" + "u003c";

export function PageJsonLd({
  path,
  name,
  description,
  faq,
  article,
}: {
  path: ToolPath | typeof BOT_PAGE_PATH | typeof PAST_QUESTIONS_PATH;
  name: string;
  description: string;
  faq: readonly FaqItem[];
  /** For the study guide: publish it as an Article. */
  article?: { datePublished: string };
}) {
  const url = `${SITE_URL}${path}`;
  const org = { "@id": SITE_ENTITY_IDS.organization };
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": SITE_ENTITY_IDS.organization,
        name: SITE_NAME,
        alternateName: "نيـرو ليرن",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icon.svg`,
        email: LEGAL_CONTACT_EMAIL,
        description: SITE_ENTITY_DESCRIPTION_AR,
      },
      {
        "@type": article ? "Article" : "WebPage",
        "@id": `${url}#page`,
        url,
        name,
        ...(article ? { headline: name } : {}),
        description,
        inLanguage: "ar",
        isPartOf: { "@id": SITE_ENTITY_IDS.website },
        publisher: org,
        ...(article
          ? {
              author: org,
              datePublished: article.datePublished,
              mainEntityOfPage: url,
            }
          : { about: { "@id": SITE_ENTITY_IDS.software } }),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: SITE_NAME,
            item: `${SITE_URL}/`,
          },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: "ar",
        mainEntity: faq.map(item => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, LT_ESCAPE),
      }}
    />
  );
}
