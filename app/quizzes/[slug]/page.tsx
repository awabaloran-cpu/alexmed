import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap, Users } from "lucide-react";
import { Cover } from "@/components/discover/Cover";
import { PublicQuiz } from "@/components/discover/PublicQuiz";
import s from "@/components/discover/public.module.css";
import { MarketingPage } from "@/components/landing/SiteChrome";
import { label, translate, type DiscoverKey } from "@/lib/discover/i18n";
import {
  PUBLIC_QUIZZES,
  publicQuiz,
  quizJsonLd,
  quizPath,
  QUIZZES_PATH,
  relatedQuizzes,
} from "@/lib/discover/public";
import { BASE_OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";

// 🌍 One quiz, public: its questions and answers as readable text, playable
// on the page itself, with the way into the app (learn mode, flashcards,
// a game with friends) beside it. Built once, from the catalogue's files.
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_QUIZZES.map(quiz => ({ slug: quiz.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const quiz = publicQuiz((await params).slug);
  if (!quiz) return {};
  const count = translate(quiz.language, "card.questions", {
    n: quiz.questions.length,
  });
  const title = `${quiz.title} — ${count} | ${SITE_NAME}`;
  return {
    title,
    description: quiz.description,
    alternates: { canonical: quizPath(quiz.slug) },
    openGraph: {
      ...BASE_OPEN_GRAPH,
      type: "article",
      url: quizPath(quiz.slug),
      title,
      description: quiz.description,
      locale: quiz.language === "ar" ? "ar_AR" : "en_US",
    },
  };
}

export default async function QuizPage({ params }: Props) {
  const quiz = publicQuiz((await params).slug);
  if (!quiz) notFound();
  const language = quiz.language;
  const t = (key: DiscoverKey, values?: Record<string, string | number>) =>
    translate(language, key, values);
  const related = relatedQuizzes(quiz);

  return (
    <MarketingPage>
      <script
        type="application/ld+json"
        // Built from the catalogue's own files; no visitor input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(quizJsonLd(quiz, SITE_URL)),
        }}
      />
      {/* The quiz speaks its own language, whatever the site's frame. */}
      <article
        className={s.wrap}
        lang={language}
        dir={language === "ar" ? "rtl" : "ltr"}
        style={{ "--card": quiz.color } as React.CSSProperties}
      >
        <header className={s.quizHero}>
          <Link href={QUIZZES_PATH} className={s.back}>
            {language === "ar" ? "→" : "←"} {t("public.all")}
          </Link>
          <div className={s.quizHead}>
            <Cover art={quiz.art} color={quiz.color} className={s.quizCover} />
            <div className={s.quizText}>
              <span className={s.meta}>
                <span className={s.tag}>
                  {t("card.questions", { n: quiz.questions.length })}
                </span>
                <span className={s.tag}>{label(language, quiz.category)}</span>
                <span className={s.tag}>
                  {t("public.by", { name: quiz.channelName })}
                </span>
              </span>
              <h1>{quiz.title}</h1>
              <p className={s.lede}>{quiz.description}</p>
              <div className={s.actions}>
                <a href="#questions" className={s.buttonMain}>
                  {t("sheet.learn")}
                </a>
                <Link href={`/discover?quiz=${quiz.slug}`} className={s.button}>
                  <Users size={18} aria-hidden="true" />
                  {t("public.playFriends")}
                </Link>
              </div>
              <p className={s.hint}>{t("public.hint")}</p>
            </div>
          </div>
        </header>

        <section
          id="questions"
          className={s.block}
          aria-labelledby="questions-title"
        >
          <h2 id="questions-title">{t("public.questions")}</h2>
          <PublicQuiz quiz={quiz} language={language} />
        </section>

        <section className={s.block}>
          <div className={s.invite}>
            <h2>{t("public.inviteTitle")}</h2>
            <p>{t("public.inviteText")}</p>
            <div className={s.actions}>
              <Link
                href={`/discover/learn/${quiz.slug}`}
                className={s.buttonMain}
              >
                <GraduationCap size={18} aria-hidden="true" />
                {t("public.playApp")}
              </Link>
              <Link href={`/discover?quiz=${quiz.slug}`} className={s.button}>
                <Users size={18} aria-hidden="true" />
                {t("public.playFriends")}
              </Link>
            </div>
          </div>
        </section>

        {related.length ? (
          <section className={s.block} aria-labelledby="more-title">
            <h2 id="more-title">{t("public.more")}</h2>
            <div className={s.grid}>
              {related.map(other => (
                <Link
                  key={other.slug}
                  href={quizPath(other.slug)}
                  className={s.card}
                >
                  <Cover
                    art={other.art}
                    color={other.color}
                    className={s.cardCover}
                  />
                  <span className={s.cardBody}>
                    <b>{other.title}</b>
                    <p>{other.description}</p>
                    <span className={s.meta}>
                      <span className={s.tag}>
                        {t("card.questions", { n: other.questions.length })}
                      </span>
                      <span className={s.tag}>
                        {label(language, other.category)}
                      </span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </MarketingPage>
  );
}
