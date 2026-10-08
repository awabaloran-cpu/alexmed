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
import { BASE_OPEN_GRAPH, BOT_PAGE_PATH } from "@/lib/site";
import { telegramBotUsername } from "@/lib/telegram/config";
import b from "./bot.module.css";

// The public page for the Telegram bot (lib/telegram). Targets Arabic
// searches for a Telegram bot that turns a PDF into questions / a summary /
// flashcards ("بوت تلغرام تحويل pdf الى اسئلة", "بوت تلخيص pdf تلغرام",
// "بوت اختبارات تلغرام") — no demand numbers were measured for these; the
// page states only what the bot really does. It is also where links to the
// bot from outside Telegram (search, the site's footer) land.
const TITLE = "بوت تلغرام يحوّل PDF إلى أسئلة وملخص وفلاش كارد | NiroLearn";
const DESCRIPTION =
  "أرسل ملف PDF لبوت NiroLearn على تلغرام: ملف الأسئلة يصير اختبارًا تفاعليًا مع شرح بالعربي لكل إجابة، والكتاب يصير ملخصًا وبطاقات فلاش كارد وأسئلة. مجانًا وبدون تطبيق.";

// The label after src_ shows these visitors as coming from this page in the
// admin's source report (lib/telegram/growth.ts).
const BOT_URL = `https://t.me/${telegramBotUsername() ?? "Nirolearnbot"}?start=src_site`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: BOT_PAGE_PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: BOT_PAGE_PATH,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "كيف أحوّل ملف PDF إلى أسئلة على تلغرام؟",
    a: "افتح بوت NiroLearn على تلغرام واضغط «ابدأ»، ثم أرسل ملف الأسئلة بصيغة PDF. يقرأ البوت الملف ويستخرج أسئلته، ويرسل لك زرًا يفتحها كاختبار تفاعلي تحلّه سؤالًا سؤالًا.",
  },
  {
    q: "هل البوت مجاني؟",
    a: "نعم، تجربة أول ملف مجانية وبدون تسجيل. لرفع ملفات أخرى تنشئ حسابًا مجانيًا أو تدعو زميلًا، وكل زميل يرفع ملفه الأول يمنحك ملفًا إضافيًا.",
  },
  {
    q: "ماذا يفعل البوت بملف الكتاب أو المحاضرة؟",
    a: "يضيفه إلى كتبك في NiroLearn مقسّمًا إلى أجزاء. من صفحة الكتاب تطلب لكل جزء ملخصًا منظمًا وبطاقات فلاش كارد وأسئلة اختبار وخريطة ذهنية، كلها من محتوى ملفك.",
  },
  {
    q: "هل يقرأ الملفات الممسوحة ضوئيًا (صور)؟",
    a: "نعم. الصفحات التي لا تحتوي نصًا تُقرأ بالتعرّف الضوئي على الحروف، وهذا يأخذ وقتًا أطول من الملف النصي.",
  },
  {
    q: "هل الشرح بالعربي حتى لو كان الملف بالإنجليزية؟",
    a: "نعم. في المواد الإنجليزية مثل الطب والهندسة يبقى السؤال بلغته، ويأتي شرح الإجابة بالعربية مع إبقاء المصطلحات الإنجليزية ظاهرة.",
  },
  {
    q: "ما أكبر حجم ملف يقبله البوت؟",
    a: "يقبل البوت حاليًا ملفات PDF حتى 20 ميغابايت. الملف الأكبر ترفعه من موقع NiroLearn مباشرة.",
  },
  {
    q: "هل أحتاج تنزيل تطبيق؟",
    a: "لا. ترسل الملف في تلغرام، وتفتح الأسئلة أو الكتاب داخل تلغرام نفسه أو في المتصفح.",
  },
];

function BotButton({ children }: { children: React.ReactNode }) {
  return (
    <a href={BOT_URL} className={s.primary} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

// An illustration of the conversation, with sample content (labelled so).
function ChatFigure() {
  return (
    <figure className={b.chat} aria-label="مثال توضيحي لمحادثة مع البوت">
      <div className={`${b.bubble} ${b.out}`}>
        <span className={b.file}>📄 Pediatrics_MCQs.pdf</span>
      </div>
      <div className={b.bubble}>🔍 جاري قراءة الملف…</div>
      <div className={b.bubble}>
        🎉 أسئلتك جاهزة — ابدأ الآن
        <br />
        عدد الأسئلة: 80
        <span className={b.button}>🚀 ابدأ الأسئلة</span>
      </div>
      <div className={b.card}>
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

export default function TelegramBotPage() {
  return (
    <MarketingPage>
      <PageJsonLd
        path={BOT_PAGE_PATH}
        name="بوت تلغرام يحوّل PDF إلى أسئلة وملخص وفلاش كارد"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <section className={s.toolHero} aria-labelledby="page-title">
        <div className={s.toolHeroCopy}>
          <h1 id="page-title" className={s.heroTitle}>
            بوت تلغرام يحوّل ملف PDF إلى أسئلة تفاعلية وملخص وفلاش كارد
          </h1>
          <div className={s.heroLede}>
            <p>
              أرسل ملفك لبوت NiroLearn على تلغرام. ملف الأسئلة يصير اختبارًا
              تحلّه سؤالًا سؤالًا مع شرح بالعربي لكل إجابة، والكتاب أو المحاضرة
              يُضاف إلى كتبك لتطلب منه الملخص والبطاقات والأسئلة.
            </p>
          </div>
          <div className={s.ctaRow}>
            <BotButton>افتح البوت في تلغرام</BotButton>
            <Link href="/register" className={s.secondary}>
              أو أنشئ حسابًا على الموقع
            </Link>
          </div>
          <p className={s.fineprint}>
            أول ملف مجانًا وبدون تسجيل. ملفات PDF حتى 20 ميغابايت.
          </p>
        </div>
        <div className={s.toolHeroFigure}>
          <ChatFigure />
        </div>
      </section>

      <Section
        id="how"
        title="كيف يعمل؟"
        intro="ثلاث خطوات، كلها داخل تلغرام."
      >
        <ol className={b.steps}>
          <li>
            <strong>أرسل الملف</strong>
            <p>
              افتح البوت واضغط «ابدأ»، ثم أرسل ملف PDF: ملف أسئلة سنوات سابقة،
              أو كتابًا، أو محاضرة.
            </p>
          </li>
          <li>
            <strong>البوت يقرأه</strong>
            <p>
              يحدد إن كان ملف أسئلة أو كتابًا ويعالجه. ملف الأسئلة النصي يجهز
              خلال ثوانٍ، والممسوح ضوئيًا يأخذ أطول.
            </p>
          </li>
          <li>
            <strong>ابدأ المذاكرة</strong>
            <p>
              يصلك زر يفتح ملفك مباشرة. تقدّمك يُحفظ، فتكمل من حيث توقفت في
              أي وقت.
            </p>
          </li>
        </ol>
      </Section>

      <Section id="questions" title="ماذا تحصل من ملف الأسئلة؟">
        <div className={s.prose}>
          <ul>
            <li>
              <strong>اختبار تفاعلي</strong>: سؤال واحد في كل مرة، تختار
              الإجابة فتعرف فورًا إن كانت صحيحة.
            </li>
            <li>
              <strong>شرح بالعربي</strong> لكل إجابة، مع إبقاء المصطلحات
              الإنجليزية كما هي في المواد الإنجليزية.
            </li>
            <li>
              <strong>«اربطها»</strong>: جملة قصيرة تربط مفتاح السؤال بالإجابة
              ليسهل تذكّرها.
            </li>
            <li>
              <strong>كلمات مفتاحية</strong> لكل سؤال، وترجمة عربية للسؤال
              وخياراته عند الحاجة.
            </li>
            <li>
              <strong>الإجابة المذكورة في الملف</strong> هي المعتمدة. إن لم
              يذكر الملف إجابة، تظهر إجابة مقترحة وعليها علامة أنها من الذكاء
              الاصطناعي.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="books" title="وماذا عن الكتاب أو المحاضرة؟">
        <div className={s.prose}>
          <p>
            يُضاف الملف إلى كتبك في NiroLearn مقسّمًا إلى أجزاء، ومن صفحته تطلب
            لكل جزء ما تحتاجه:
          </p>
          <ul>
            <li>
              <Link href="/pdf-summary">ملخص منظم</Link> بعناوينه وأهم نقاطه.
            </li>
            <li>
              <Link href="/flashcards">بطاقات فلاش كارد</Link> تعود إليك
              بالتكرار المتباعد.
            </li>
            <li>أسئلة اختبار من محتوى الملف، مع شرح لكل إجابة.</li>
            <li>
              <Link href="/mind-map">خريطة ذهنية</Link> لكل جزء.
            </li>
          </ul>
        </div>
      </Section>

      <FaqSection items={FAQ} />
      <RelatedPages />
      <section className={s.cta} aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">جرّب بملفك الآن</h2>
          <p>أرسل أول ملف مجانًا، وابدأ حلّ أسئلته خلال دقيقة.</p>
          <BotButton>افتح البوت في تلغرام</BotButton>
        </div>
      </section>
    </MarketingPage>
  );
}
