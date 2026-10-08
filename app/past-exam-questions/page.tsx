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
} from "@/lib/site";
import { telegramBotUsername } from "@/lib/telegram/config";
// The numbered steps and the question card are the bot page's.
import b from "../telegram-bot/bot.module.css";
import y from "./years.module.css";

// The public page for students who study from past-exam question files.
// Wording follows what they search for (OpenSEO, 2026-10): "اسئلة سنوات
// سابقة" 2,400/mo in Jordan (KD 0; ~10 in Saudi Arabia and Egypt, where
// "بنك الاسئلة" — 1,300 / 880, 720 in Jordan — is the phrase), and "حل
// اسئلة" 4,400 / 1,000 / 12,100 (Jordan / Saudi / Egypt). Most of those
// searches want a file to download; this page does not offer one and says
// so — it is for the student who already has the file.
const TITLE =
  "أسئلة سنوات سابقة: حوّل ملف PDF إلى اختبار تفاعلي مع شرح | NiroLearn";
const DESCRIPTION =
  "عندك ملف أسئلة سنوات سابقة أو بنك أسئلة بصيغة PDF؟ ارفعه إلى NiroLearn ليصير اختبارًا تحلّه سؤالًا سؤالًا، مع تصحيح فوري وشرح بالعربي لكل إجابة، وشاركه مع دفعتك برابط.";

// The label after src_ shows these visitors as coming from this page in the
// admin's source report (lib/telegram/growth.ts).
const BOT_URL = `https://t.me/${telegramBotUsername() ?? "Nirolearnbot"}?start=src_seo_years`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAST_QUESTIONS_PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: PAST_QUESTIONS_PATH,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "هل أجد على NiroLearn ملفات أسئلة سنوات سابقة جاهزة للتحميل؟",
    a: "لا. NiroLearn لا ينشر ملفات أسئلة. أنت ترفع الملف الذي معك، من مجموعة دفعتك أو من دكتور المادة، والمنصة تحوّله إلى اختبار تفاعلي خاص بك.",
  },
  {
    q: "كيف أحوّل ملف أسئلة السنوات إلى اختبار تفاعلي؟",
    a: "ارفع ملف PDF من الموقع أو أرسله لبوت NiroLearn على تلغرام. تُستخرج أسئلته بخياراتها وإجاباتها، ثم تفتحه كاختبار تحلّه سؤالًا سؤالًا مع تصحيح فوري.",
  },
  {
    q: "هل يحلّ الأسئلة إن لم تكن الإجابات مكتوبة في الملف؟",
    a: "الإجابة المذكورة في الملف هي المعتمدة. إن لم يذكر الملف إجابة، تظهر إجابة مقترحة وعليها علامة أنها من الذكاء الاصطناعي، فراجعها مع مصدرك.",
  },
  {
    q: "هل يقرأ ملفات السنوات المصوّرة بالهاتف أو الممسوحة ضوئيًا؟",
    a: "نعم. الصفحات التي لا تحتوي نصًا تُقرأ بالتعرّف الضوئي على الحروف، وهذا يأخذ وقتًا أطول. كلما كانت الصورة أوضح كان الاستخراج أدق.",
  },
  {
    q: "هل الشرح بالعربي إن كانت الأسئلة بالإنجليزية؟",
    a: "نعم. يبقى السؤال بلغته، ويأتي شرح الإجابة بالعربية مع إبقاء المصطلحات الإنجليزية ظاهرة، وهذا يناسب مواد الطب والصيدلة والهندسة.",
  },
  {
    q: "هل أستطيع مشاركة الملف مع زملائي؟",
    a: "نعم. من صفحة الملف أو من البوت تنشئ رابط مشاركة وترسله لدفعتك. يفتح زملاؤك الملف نفسه في تلغرام، ولكل واحد إجاباته وتقدّمه، وتوقف الرابط متى شئت.",
  },
  {
    q: "هل هو مجاني؟",
    a: "أول ملف عبر بوت تلغرام مجاني وبدون تسجيل. بعده تنشئ حسابًا مجانيًا، وحدود الرفع تتبع باقتك.",
  },
  {
    q: "ما أكبر حجم ملف؟",
    a: "بوت تلغرام يقبل ملفات PDF حتى 20 ميغابايت. الملف الأكبر ترفعه من الموقع.",
  },
];

function BotButton({ children }: { children: React.ReactNode }) {
  return (
    <a href={BOT_URL} className={s.primary} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

// Before and after, with sample content (labelled so): the same question as
// a line in a PDF, then as a card in the quiz.
function BeforeAfterFigure() {
  return (
    <figure className={y.figure} aria-label="مثال توضيحي: السؤال قبل وبعد">
      <div className={y.sheet}>
        <span className={y.tag}>في ملف PDF</span>
        <p>
          12. A child presents with a barking cough. What is the most likely
          diagnosis?
        </p>
        <p>A. Epiglottitis B. Croup C. Bronchiolitis</p>
        <p>Answer: B</p>
      </div>
      <div className={b.card}>
        <span className={y.tag} dir="rtl">
          في NiroLearn
        </span>
        <p className={b.cardStem}>
          A child presents with a barking cough. What is the most likely
          diagnosis?
        </p>
        <ul>
          <li>Epiglottitis</li>
          <li className={b.right}>Croup ✓</li>
          <li>Bronchiolitis</li>
        </ul>
        <p className={b.hook} dir="rtl">
          🔗 اربطها: Barking cough → Croup 🐕
        </p>
      </div>
      <figcaption>مثال توضيحي بمحتوى تجريبي.</figcaption>
    </figure>
  );
}

export default function PastExamQuestionsPage() {
  return (
    <MarketingPage>
      <PageJsonLd
        path={PAST_QUESTIONS_PATH}
        name="أسئلة سنوات سابقة: من ملف PDF إلى اختبار تفاعلي مع شرح"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <section className={s.toolHero} aria-labelledby="page-title">
        <div className={s.toolHeroCopy}>
          <h1 id="page-title" className={s.heroTitle}>
            أسئلة سنوات سابقة: حوّل ملفك إلى اختبار تفاعلي مع شرح
          </h1>
          <div className={s.heroLede}>
            <p>
              ملف أسئلة السنوات الذي وصلك من الدفعة يُقرأ قراءة ثم يُنسى. ارفعه
              إلى NiroLearn ليصير اختبارًا تحلّه سؤالًا سؤالًا: تختار الإجابة،
              تعرف فورًا إن أصبت، وتقرأ الشرح بالعربي.
            </p>
          </div>
          <div className={s.ctaRow}>
            <BotButton>جرّب بملفك في تلغرام</BotButton>
            <Link href="/register" className={s.secondary}>
              أو ارفعه من الموقع
            </Link>
          </div>
          <p className={s.fineprint}>
            أول ملف عبر البوت مجانًا وبدون تسجيل. NiroLearn لا ينشر ملفات
            أسئلة: أنت ترفع ملفك.
          </p>
        </div>
        <div className={s.toolHeroFigure}>
          <BeforeAfterFigure />
        </div>
      </section>

      <Section
        id="how"
        title="كيف تحوّل ملف أسئلة السنوات إلى اختبار؟"
        intro="ثلاث خطوات، من الهاتف أو الحاسوب."
      >
        <ol className={b.steps}>
          <li>
            <strong>ارفع ملف PDF</strong>
            <p>
              ملف سنوات مادة واحدة، تجميعة امتحانات، أو بنك أسئلة كامل. من
              الموقع، أو أرسله <Link href={BOT_PAGE_PATH}>لبوت تلغرام</Link>.
            </p>
          </li>
          <li>
            <strong>تُستخرج الأسئلة</strong>
            <p>
              كل سؤال بخياراته والإجابة المذكورة في الملف. الملف النصي يجهز
              خلال ثوانٍ، والمصوّر يأخذ أطول.
            </p>
          </li>
          <li>
            <strong>حلّ وراجع</strong>
            <p>
              سؤال واحد في كل مرة مع تصحيح فوري. تقدّمك يُحفظ، فتكمل من حيث
              توقفت.
            </p>
          </li>
        </ol>
      </Section>

      <Section id="why" title="لماذا لا تكفي قراءة ملف السنوات؟">
        <div className={s.prose}>
          <p>
            حين تقرأ السؤال وتحته إجابته، تشعر أنك تعرفه. الامتحان يسألك دون
            إجابة أمامك. حلّ السؤال قبل رؤية إجابته هو ما يثبّت المعلومة،
            وهذا ما يفعله الاختبار التفاعلي:
          </p>
          <ul>
            <li>
              <strong>تجيب أولًا</strong>، ثم ترى الإجابة الصحيحة. لا تمرّ على
              السؤال مرور القراءة.
            </li>
            <li>
              <strong>شرح بالعربي</strong> لكل إجابة: لماذا هي الصحيحة، مع
              إبقاء المصطلحات الإنجليزية كما هي.
            </li>
            <li>
              <strong>«اربطها»</strong>: جملة قصيرة تربط مفتاح السؤال بإجابته،
              لتتذكّرها حين يتكرر السؤال بصيغة أخرى.
            </li>
            <li>
              <strong>نتيجتك في النهاية</strong>: كم سؤالًا أصبت، لتعرف أين
              تحتاج مراجعة قبل الامتحان.
            </li>
          </ul>
          <p>
            لتفاصيل أكثر، وما الذي يجعل الملف يُقرأ بدقة:{" "}
            <Link href="/learn/pdf-questions-to-interactive-quiz">
              تحويل ملف أسئلة PDF إلى اختبار تفاعلي
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section id="share" title="ملف واحد لكل الدفعة">
        <div className={s.prose}>
          <p>
            أسئلة السنوات تنتقل بين الطلاب أصلًا. بدل إرسال ملف PDF للمجموعة،
            أرسل رابط الملف بعد تحويله:
          </p>
          <ul>
            <li>زملاؤك يفتحون الاختبار نفسه في تلغرام، دون رفع جديد.</li>
            <li>لكل طالب إجاباته وتقدّمه، ولا يرى أحد نتيجة غيره.</li>
            <li>لا يستطيع أحد تعديل ملفك، وتوقف الرابط متى شئت.</li>
          </ul>
        </div>
      </Section>

      <Section id="files" title="أي ملفات تصلح؟">
        <div className={s.prose}>
          <ul>
            <li>
              <strong>أسئلة اختيار من متعدد</strong> (MCQ) مرقّمة، بخيارات
              واضحة. هذا ما يُستخرج بأعلى دقة.
            </li>
            <li>
              <strong>الإجابات</strong> تحت كل سؤال أو في مفتاح آخر الملف.
            </li>
            <li>
              <strong>ملفات مصوّرة</strong> أو ممسوحة ضوئيًا، ما دامت الصورة
              مقروءة.
            </li>
          </ul>
          <p>
            عندك كتاب أو محاضرة لا ملف أسئلة؟ ارفعه لتحصل على{" "}
            <Link href="/pdf-summary">ملخص</Link> و
            <Link href="/flashcards">فلاش كارد</Link> وأسئلة من محتواه.
          </p>
        </div>
      </Section>

      <FaqSection items={FAQ} />
      <RelatedPages />
      <section className={s.cta} aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">جرّب بملف السنوات الذي معك</h2>
          <p>أرسل أول ملف مجانًا، وابدأ حلّ أسئلته خلال دقيقة.</p>
          <BotButton>افتح البوت في تلغرام</BotButton>
        </div>
      </section>
    </MarketingPage>
  );
}
