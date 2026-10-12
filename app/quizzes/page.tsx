import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Cover } from "@/components/discover/Cover";
import s from "@/components/discover/public.module.css";
import { MarketingPage } from "@/components/landing/SiteChrome";
import type { DiscoverLanguage } from "@/lib/discover/data";
import { label, translate } from "@/lib/discover/i18n";
import {
  PUBLIC_QUIZZES,
  quizPath,
  quizzesIn,
  totalQuestions,
  type PublicQuiz,
} from "@/lib/discover/public";
import { BASE_OPEN_GRAPH, SITE_URL } from "@/lib/site";

// 🌍 Every quiz of the catalogue, for anyone to read and play — no account
// needed. Arabic first (the site's language), then the English shelf;
// inside each, by subject.
const TITLE =
  "اختبارات جاهزة بالعربية والإنجليزية: معلومات عامة وعلوم | NiroLearn";
const DESCRIPTION = `${PUBLIC_QUIZZES.length} اختبارًا جاهزًا في المعلومات العامة والعلوم والجغرافيا والتاريخ والتكنولوجيا واللغة والصحة، بالعربية والإنجليزية. اقرأ الأسئلة وأجب عنها مباشرة دون تسجيل.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/quizzes" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/quizzes",
    title: TITLE,
    description: DESCRIPTION,
  },
};

function QuizCard({
  quiz,
  language,
}: {
  quiz: PublicQuiz;
  language: DiscoverLanguage;
}) {
  return (
    <Link href={quizPath(quiz.slug)} className={s.card}>
      <Cover art={quiz.art} color={quiz.color} className={s.cardCover} />
      <span className={s.cardBody}>
        <b dir="auto">{quiz.title}</b>
        <p dir="auto">{quiz.description}</p>
        <span className={s.meta}>
          <span className={s.tag}>
            {translate(language, "card.questions", {
              n: quiz.questions.length,
            })}
          </span>
          <span className={s.tag}>{label(language, quiz.category)}</span>
        </span>
      </span>
    </Link>
  );
}

// One language's shelf, a subject at a time, in the order the catalogue
// first meets each subject.
function Shelf({
  id,
  language,
  title,
  note,
}: {
  id: string;
  language: DiscoverLanguage;
  title: string;
  note: string;
}) {
  const quizzes = quizzesIn(language);
  const subjects = [...new Set(quizzes.map(quiz => quiz.category))];
  return (
    <section
      id={id}
      className={s.group}
      lang={language}
      dir={language === "ar" ? "rtl" : "ltr"}
      aria-labelledby={`${id}-title`}
    >
      <div className={s.groupHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        <span>{note}</span>
      </div>
      <nav className={s.jump} aria-label={title}>
        {subjects.map(subject => (
          <a key={subject} href={`#${id}-${subject}`} className={s.chip}>
            {label(language, subject)}
          </a>
        ))}
      </nav>
      {subjects.map(subject => (
        <div key={subject} id={`${id}-${subject}`} className={s.subject}>
          <h3>{label(language, subject)}</h3>
          <div className={s.grid}>
            {quizzes
              .filter(quiz => quiz.category === subject)
              .map(quiz => (
                <QuizCard key={quiz.slug} quiz={quiz} language={language} />
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function QuizzesPage() {
  const arabic = quizzesIn("ar");
  const english = quizzesIn("en");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/quizzes`,
    inLanguage: ["ar", "en"],
    hasPart: PUBLIC_QUIZZES.map(quiz => ({
      "@type": "Quiz",
      name: quiz.title,
      inLanguage: quiz.language,
      url: `${SITE_URL}${quizPath(quiz.slug)}`,
    })),
  };
  return (
    <MarketingPage>
      <script
        type="application/ld+json"
        // Built from the catalogue's own files above; no visitor input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={s.wrap}>
        <header className={s.hero}>
          <span className={s.eyebrow}>
            <Sparkles size={15} aria-hidden="true" /> مفتوحة للجميع دون تسجيل
          </span>
          <h1>
            اختبارات جاهزة: <mark>اقرأ، أجب، واعرف نتيجتك</mark>
          </h1>
          <p className={s.lede}>
            اختبارات قصيرة كتبها فريق NiroLearn في المعلومات العامة والعلوم
            والجغرافيا والتاريخ والتكنولوجيا واللغة والصحة. كل اختبار صفحة
            واحدة: الأسئلة أمامك، تختار إجابتك فترى الصحيح فورًا، ونتيجتك في آخر
            الصفحة.
          </p>
          <ul className={s.facts}>
            <li>
              <b>{PUBLIC_QUIZZES.length}</b>
              <span>اختبارًا</span>
            </li>
            <li>
              <b>{totalQuestions(PUBLIC_QUIZZES)}</b>
              <span>سؤالًا مع أجوبتها</span>
            </li>
            <li>
              <b>2</b>
              <span>لغتان: العربية والإنجليزية</span>
            </li>
          </ul>
          <nav className={s.jump} aria-label="لغة الاختبارات">
            <a href="#arabic" className={s.chip}>
              بالعربية ({arabic.length})
            </a>
            <a href="#english" className={s.chip}>
              English ({english.length})
            </a>
          </nav>
        </header>

        <Shelf
          id="arabic"
          language="ar"
          title="اختبارات بالعربية"
          note={`${arabic.length} اختبارًا · ${totalQuestions(arabic)} سؤالًا`}
        />
        <Shelf
          id="english"
          language="en"
          title="Quizzes in English"
          note={`${english.length} quizzes · ${totalQuestions(english)} questions`}
        />

        <section className={s.block}>
          <div className={s.invite}>
            <h2>{translate("ar", "public.inviteTitle")}</h2>
            <p>{translate("ar", "public.inviteText")}</p>
            <div className={s.actions}>
              <Link href="/register" className={s.buttonMain}>
                ابدأ مجانًا
              </Link>
              <Link href="/about" className={s.button}>
                من نحن
              </Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingPage>
  );
}
