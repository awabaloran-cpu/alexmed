import type { Metadata } from "next";
import Link from "next/link";
import {
  FaqSection,
  PageJsonLd,
  RelatedPages,
  Section,
  type FaqItem,
} from "@/components/landing/PageBits";
import { MarketingPage } from "@/components/landing/SiteChrome";
import s from "@/components/landing/landing.module.css";
import {
  BASE_OPEN_GRAPH,
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  SOLVE_QUESTIONS_PATH,
} from "@/lib/site";
import { telegramBotUsername } from "@/lib/telegram/config";
// The numbered steps and the question card are the bot page's.
import b from "../telegram-bot/bot.module.css";

// The public page for "حل اسئلة" — 12,100/mo in Egypt, 4,400 in Jordan,
// 1,000 in Saudi Arabia (OpenSEO, 2026-10). The results for it are short
// videos, social posts and quiz-game apps about solving questions with AI,
// not a tool. What NiroLearn really does for that search: it reads a PDF of
// multiple-choice questions and shows each answer with an Arabic
// explanation — the file's own answer when it has one, otherwise an answer
// marked as suggested by AI. The page says exactly that, and that it does
// not solve a typed question or written homework.
const TITLE = "حل أسئلة بالذكاء الاصطناعي مع الشرح: أرسل ملف PDF | NiroLearn";
const DESCRIPTION =
  "أرسل ملف أسئلة الاختيار من متعدد بصيغة PDF إلى NiroLearn: يستخرج كل سؤال، يعرض إجابته مع شرح بالعربي، ويحوّل الملف إلى اختبار تحلّه بنفسك. أول ملف مجانًا عبر تلغرام.";

// The label after src_ shows these visitors as coming from this page in the
// admin's source report (lib/telegram/growth.ts).
const BOT_URL = `https://t.me/${telegramBotUsername() ?? "Nirolearnbot"}?start=src_seo_solve`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SOLVE_QUESTIONS_PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: SOLVE_QUESTIONS_PATH,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "كيف أحل أسئلة ملف PDF بالذكاء الاصطناعي؟",
    a: "أرسل الملف لبوت NiroLearn على تلغرام أو ارفعه من الموقع. تُستخرج الأسئلة بخياراتها، ثم تفتح الملف كاختبار: تختار إجابتك، ترى الإجابة الصحيحة، وتقرأ شرحها بالعربي.",
  },
  {
    q: "هل الإجابات صحيحة دائمًا؟",
    a: "لا يوجد ذكاء اصطناعي صحيح دائمًا. إن كانت الإجابة مكتوبة في ملفك فهي المعتمدة. وإن لم تكن، تظهر إجابة مقترحة وعليها علامة أنها من الذكاء الاصطناعي، فراجعها مع كتابك أو دكتور المادة.",
  },
  {
    q: "هل أستطيع كتابة سؤال واحد ليحلّه؟",
    a: "لا. NiroLearn يعمل على الملفات: ترفع ملف الأسئلة كاملًا فيتحوّل إلى اختبار. لسؤال واحد سريع، مساعد محادثة عام يكفيك.",
  },
  {
    q: "هل يحل الأسئلة المقالية والمسائل الحسابية؟",
    a: "الاختبار التفاعلي لأسئلة الاختيار من متعدد. إن كان ملفك شرحًا أو مسائل مقالية، حوّله إلى كتاب داخل المنصة لتحصل على ملخص وفلاش كارد وأسئلة من محتواه.",
  },
  {
    q: "هل يشرح بالعربي إن كانت الأسئلة بالإنجليزية؟",
    a: "نعم. يبقى السؤال بلغته، ويأتي الشرح بالعربية مع إبقاء المصطلحات الإنجليزية ظاهرة. هذا يناسب مواد الطب والصيدلة والهندسة.",
  },
  {
    q: "هل يقرأ صور الأسئلة والملفات الممسوحة ضوئيًا؟",
    a: "يقرأ ملفات PDF المصوّرة بالتعرّف الضوئي على الحروف، وهذا يأخذ وقتًا أطول. صورة منفردة حوّلها إلى PDF أولًا، وكلما كانت أوضح كان الاستخراج أدق.",
  },
  {
    q: "هل هو مجاني؟",
    a: "أول ملف عبر بوت تلغرام مجاني وبدون تسجيل. بعده تنشئ حسابًا مجانيًا، وحدود الرفع تتبع باقتك.",
  },
  {
    q: "هل هذا غش؟",
    a: "NiroLearn للمذاكرة قبل الامتحان، لا للحل أثناءه. فكرته أن تجيب أنت أولًا ثم ترى الشرح، وهذا ما يثبّت المعلومة.",
  },
];

function BotButton({ children }: { children: React.ReactNode }) {
  return (
    <a href={BOT_URL} className={s.primary} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

// One solved question, with sample content (labelled so).
function SolvedFigure() {
  return (
    <figure aria-label="مثال توضيحي: سؤال محلول مع الشرح">
      <div className={b.card}>
        <p className={b.cardStem}>Which vitamin deficiency causes scurvy?</p>
        <ul>
          <li>Vitamin A</li>
          <li className={b.right}>Vitamin C ✓</li>
          <li>Vitamin D</li>
        </ul>
        <p className={b.hook} dir="rtl">
          💡 الشرح: نقص Vitamin C يضعف تكوين الكولاجين، فتنزف اللثة وتتأخر
          الجروح في الالتئام.
        </p>
      </div>
      <figcaption>مثال توضيحي بمحتوى تجريبي.</figcaption>
    </figure>
  );
}

export default function SolveQuestionsPage() {
  return (
    <MarketingPage>
      <PageJsonLd
        path={SOLVE_QUESTIONS_PATH}
        name="حل أسئلة بالذكاء الاصطناعي مع الشرح من ملف PDF"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <section className={s.toolHero} aria-labelledby="page-title">
        <div className={s.toolHeroCopy}>
          <h1 id="page-title" className={s.heroTitle}>
            حل أسئلة بالذكاء الاصطناعي مع شرح كل إجابة
          </h1>
          <div className={s.heroLede}>
            <p>
              أرسل ملف أسئلة الاختيار من متعدد بصيغة PDF. يستخرج NiroLearn كل
              سؤال، يعرض إجابته، ويشرح بالعربي لماذا هي الصحيحة. وتحلّه أنت
              كاختبار قبل أن ترى الحل.
            </p>
          </div>
          <div className={s.ctaRow}>
            <BotButton>أرسل ملفك في تلغرام</BotButton>
            <Link href="/register" className={s.secondary}>
              أو ارفعه من الموقع
            </Link>
          </div>
          <p className={s.fineprint}>
            أول ملف عبر البوت مجانًا وبدون تسجيل. يعمل على ملفات PDF، لا على
            سؤال مكتوب منفرد.
          </p>
        </div>
        <div className={s.toolHeroFigure}>
          <SolvedFigure />
        </div>
      </section>

      <Section
        id="how"
        title="كيف تحل أسئلة ملف كامل؟"
        intro="ثلاث خطوات، من الهاتف أو الحاسوب."
      >
        <ol className={b.steps}>
          <li>
            <strong>أرسل ملف الأسئلة</strong>
            <p>
              ملف PDF فيه أسئلة اختيار من متعدد: واجب، تجميعة، أو{" "}
              <Link href={PAST_QUESTIONS_PATH}>أسئلة سنوات سابقة</Link>. أرسله{" "}
              <Link href={BOT_PAGE_PATH}>لبوت تلغرام</Link> أو ارفعه من الموقع.
            </p>
          </li>
          <li>
            <strong>تُستخرج الأسئلة وتُحل</strong>
            <p>
              كل سؤال بخياراته. الإجابة المكتوبة في الملف تُعتمد كما هي، وما لا
              إجابة له يأخذ إجابة مقترحة معلَّمة بأنها من الذكاء الاصطناعي.
            </p>
          </li>
          <li>
            <strong>حلّ ثم اقرأ الشرح</strong>
            <p>
              تختار إجابتك أولًا، ثم ترى الصحيحة وشرحها. تقدّمك يُحفظ، وفي
              النهاية ترى نتيجتك.
            </p>
          </li>
        </ol>
      </Section>

      <Section id="honest" title="ما الذي يحلّه، وما الذي لا يحلّه؟">
        <div className={s.prose}>
          <ul>
            <li>
              <strong>يحلّ:</strong> أسئلة الاختيار من متعدد (MCQ) المرقّمة في
              ملف PDF، نصيًا كان أو مصوّرًا بوضوح.
            </li>
            <li>
              <strong>يشرح:</strong> لماذا الإجابة صحيحة، بالعربية، مع جملة
              «اربطها» تساعدك على تذكّرها.
            </li>
            <li>
              <strong>لا يحلّ:</strong> سؤالًا تكتبه في المحادثة، ولا واجبًا
              مقاليًا أو مسألة تحتاج خطوات مكتوبة.
            </li>
            <li>
              <strong>لا يضمن:</strong> صحة الإجابة المقترحة من الذكاء
              الاصطناعي. لهذا تُعلَّم بوضوح، وتبقى إجابة ملفك هي المعتمدة.
            </li>
          </ul>
          <p>
            عندك كتاب أو محاضرة لا ملف أسئلة؟ ارفعه لتحصل على{" "}
            <Link href="/pdf-summary">ملخص</Link> و
            <Link href="/flashcards">فلاش كارد</Link> وأسئلة من محتواه.
          </p>
        </div>
      </Section>

      <Section id="why" title="لماذا تحلّ بنفسك قبل أن ترى الحل؟">
        <div className={s.prose}>
          <p>
            نسخ الحل الجاهز ينهي الواجب ولا ينفعك في الامتحان. حين تحاول الإجابة
            أولًا ثم تقرأ الشرح، تعرف بالضبط ما الذي لم تفهمه. لهذا يعرض
            NiroLearn السؤال دون إجابته، ويكشفها بعد اختيارك.
          </p>
          <p>
            تفاصيل أكثر عن تجهيز الملف ليُقرأ بدقة:{" "}
            <Link href="/learn/pdf-questions-to-interactive-quiz">
              تحويل ملف أسئلة PDF إلى اختبار تفاعلي
            </Link>
            .
          </p>
        </div>
      </Section>

      <FaqSection items={FAQ} />
      <RelatedPages current={SOLVE_QUESTIONS_PATH} />
      <section className={s.cta} aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">جرّب بملف الأسئلة الذي معك</h2>
          <p>أرسل أول ملف مجانًا، وابدأ حلّ أسئلته خلال دقيقة.</p>
          <BotButton>افتح البوت في تلغرام</BotButton>
        </div>
      </section>
    </MarketingPage>
  );
}
