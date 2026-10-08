// Public landing page for signed-out visitors at "/". Server component
// only: no client JavaScript of its own (FAQ uses <details>). Copy
// describes features that exist today; every preview is labelled as example
// content. Sign-up and sign-in go to the existing /register and /login.
import Link from "next/link";
import NiroCharacter from "@/components/niro/NiroCharacter";
import {
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  SOLVE_QUESTIONS_PATH,
} from "@/lib/site";
import s from "./landing.module.css";
import {
  AssistantPreview,
  FlashcardPreview,
  MindMapPreview,
  MINUS_70,
  QuizPreview,
  SummaryPreview,
} from "./Previews";
import BeforeAfter from "./BeforeAfter";
import { MarketingPage } from "./SiteChrome";
import { AfterAll, LecturePage } from "./Transformations";

// Questions and wording follow what students search for (OpenSEO, Saudi
// market): the first answer is the plain definition of NiroLearn that
// search engines and AI answers can quote. Also emitted as FAQPage JSON-LD.
export const LANDING_FAQ = [
  {
    q: "ما هو NiroLearn؟",
    a: "NiroLearn منصة مذاكرة عربية تعمل بالذكاء الاصطناعي. ترفع ملف PDF لكتابك أو محاضرتك، فتحصل منه على ملخص منظم، وExam Focus لأهم معلومات الامتحان، وفلاش كارد بمراجعة متباعدة، واختبارات، وخريطة ذهنية، ومساعد دراسة يجيب من صفحات ملفك.",
  },
  {
    q: "هل NiroLearn مجاني؟",
    a: "نعم، يمكنك البدء بالخطة المجانية دون بطاقة دفع. وتتوفر خطتا Pro وUltimate لحدود استخدام أعلى، وتفاصيلهما في صفحة الأسعار.",
  },
  {
    q: "ما الفرق بين NiroLearn وأدوات تلخيص PDF العامة؟",
    a: "أداة التلخيص العامة تعطيك ملخصًا للملف وتنتهي مهمتها. NiroLearn مصمَّم للمذاكرة: يقسّم الملف إلى أجزاء تذاكرها بالترتيب، ويستخرج أهم معلومات الامتحان، ويحوّل المحتوى إلى فلاش كارد واختبارات تراجعها على فترات، ويحفظ تقدّمك.",
  },
  {
    q: "ما الملفات التي يمكنني رفعها؟",
    a: "ملفات PDF: كتب، ومحاضرات، وملفات أسئلة. ويقرأ NiroLearn النص حتى من الصفحات المصوّرة.",
  },
  {
    q: "هل يلخّص ملفات PDF المكتوبة بالإنجليزية؟",
    a: "نعم. الواجهة بالعربية، ويمكنك رفع مواد بالعربية أو بالإنجليزية، مثل مواد الطب والهندسة. في المواد الإنجليزية يبقى الشرح بمصطلحات مادتك الأصلية، ومعه شرح عربي مساند وقائمة بأهم المصطلحات بالعربية والإنجليزية.",
  },
  {
    q: "ما هو التكرار المتباعد؟",
    a: "طريقة مراجعة تعيد لك المعلومة قبل أن تنساها بقليل، على فترات تطول كلما تذكّرتها. بطاقات NiroLearn تُجدوَل بهذه الطريقة حسب تقييمك لكل بطاقة، فتراجع ما تنساه أكثر مما تعرفه.",
  },
  {
    q: "هل ملفاتي خاصة؟",
    a: "ملفاتك مرتبطة بحسابك، ولا يراها غيرك إلا إذا شاركتها بنفسك مع زميل. التفاصيل في سياسة الخصوصية.",
  },
  {
    q: "كيف أنشئ حسابًا؟",
    a: "برقم هاتفك ورمز تحقق يصلك برسالة نصية، ثم تبدأ برفع أول ملف.",
  },
] as const;

const PROBLEMS = [
  {
    problem: "ملف من مئات الصفحات، ولا تعرف من أين تبدأ",
    answer:
      "يقرأ NiroLearn الملف كاملًا ويقسّمه إلى أجزاء واضحة تذاكرها بالترتيب.",
  },
  {
    problem: "وقت دراسة طويل يضيع في إعادة القراءة",
    answer: "ملخص منظم لكل جزء، بعناوين ونقاط، بدل قراءة كل شيء من جديد.",
  },
  {
    problem: "صعوبة معرفة المهم للامتحان",
    answer:
      "Exam Focus يجمع المعلومات عالية الأهمية من كامل المادة في بطاقات قصيرة.",
  },
  {
    problem: "نسيان ما ذاكرته بعد أيام",
    answer: "بطاقات مراجعة بجدولة تكرار متباعد تعيد لك كل معلومة في وقتها.",
  },
] as const;

const STEPS = [
  {
    title: "ارفع ملفك",
    text: "كتاب، أو محاضرة، أو ملف أسئلة بصيغة PDF، بالعربية أو بالإنجليزية.",
  },
  {
    title: "Niro يحلّله",
    text: "يقرأ كل الصفحات، حتى المصوّرة منها، ويبني أدوات المذاكرة من محتواها.",
  },
  {
    title: "ذاكر بذكاء",
    text: "ملخص، وExam Focus، وبطاقات، واختبارات، وخريطة ذهنية، كلها من ملفك.",
  },
] as const;

// "كيف اذاكر" (260/mo) and "طريقة المذاكرة الصحيحة" (90/mo) are answered by
// generic articles today; this is the method, tied to tools that exist.
const METHOD = [
  {
    title: "ابدأ بالصورة الكاملة",
    text: "اقرأ الملخص المنظم أو الخريطة الذهنية لكل جزء قبل التفاصيل، لتعرف كيف ترتبط الأفكار ببعضها.",
  },
  {
    title: "حدّد ما يهم في الامتحان",
    text: "Exam Focus يجمع المعلومات عالية الأهمية من الملف كاملًا، مع رقم الصفحة لترجع إلى المصدر.",
  },
  {
    title: "اختبر نفسك بدل إعادة القراءة",
    text: "هذا هو الاسترجاع النشط: أجب عن الاختبارات وحاول تذكّر إجابة الفلاش كارد قبل أن تقلبها، فتثبت المعلومة أكثر من القراءة المتكررة.",
  },
  {
    title: "راجع على فترات متباعدة",
    text: "كل بطاقة تعود إليك في موعدها حسب تقييمك لها، فتقضي وقت المراجعة على ما بدأت تنساه، لا على ما تعرفه جيدًا.",
  },
] as const;

const FOCUS_CARDS = [
  {
    tag: "لازم تعرفها",
    text: "المحور العصبي ينقل الإشارة بعيدًا عن جسم الخلية.",
  },
  {
    tag: "أرقام وحدود",
    text: <>جهد الراحة للخلية العصبية نحو {MINUS_70} ملي فولت.</>,
  },
  {
    tag: "فخ امتحان",
    text: "مضخة الصوديوم والبوتاسيوم تُخرج 3 صوديوم وتُدخل 2 بوتاسيوم، لا العكس.",
  },
] as const;

export default function Landing() {
  return (
    <MarketingPage current="/">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.heroCopy}>
          <p className={s.kicker}>
            تلخيص PDF وفلاش كارد بالذكاء الاصطناعي، بالعربي
          </p>
          <h1 id="hero-title" className={s.heroTitle}>
            حوّل ملفات PDF لكتبك ومحاضراتك إلى مذاكرة جاهزة للامتحان
          </h1>
          <p className={s.heroLede}>
            ارفع ملف PDF، وNiroLearn يقرأه كاملًا ويلخّصه في ملخص منظم، ويستخرج
            Exam Focus لأهم المعلومات، ويحوّله إلى فلاش كارد واختبارات وخريطة
            ذهنية، مع Niro مساعدك الذكي في الدراسة.
          </p>
          <div className={s.ctaRow}>
            <Link href="/register" className={s.primary}>
              ابدأ مجانًا
            </Link>
            <Link href="/login" className={s.secondary}>
              تسجيل الدخول
            </Link>
          </div>
          <p className={s.fineprint}>حساب مجاني برقم هاتفك، دون بطاقة دفع.</p>
        </div>

        <HeroSheet />
      </section>

      {/* ── Problem → solution ───────────────────────────────────── */}
      <section className={s.section} aria-labelledby="problem-title">
        <div className={s.sectionHead}>
          <h2 id="problem-title">المذاكرة صعبة لأسباب نعرفها</h2>
          <p>والحل ليس أن تذاكر أكثر، بل أن تعرف ماذا تذاكر وكيف تثبّته.</p>
        </div>
        <ol className={s.ledger}>
          {PROBLEMS.map(item => (
            <li key={item.problem} className={s.ledgerRow}>
              <p className={s.ledgerProblem}>
                <span className={s.strike}>{item.problem}</span>
              </p>
              <p className={s.ledgerAnswer}>{item.answer}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Before / after ─────────────────────────────────────────── */}
      <section
        id="before-after"
        className={s.section}
        aria-labelledby="ba-title"
      >
        <div className={s.sectionHead}>
          <h2 id="ba-title">الصفحة نفسها، قبل NiroLearn وبعده</h2>
          <p>
            صفحة كثيفة من محاضرة إنجليزية تصبح ملخصًا واضحًا مع شرح عربي، وأهم
            معلومة للامتحان، وبطاقة تراجعها.
          </p>
        </div>
        <BeforeAfter
          before={<LecturePage />}
          after={<AfterAll />}
          caption="مثال توضيحي بمحتوى تجريبي. اسحب الخط للمقارنة."
        />
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how" className={s.section} aria-labelledby="how-title">
        <div className={s.sectionHead}>
          <h2 id="how-title">كيف يعمل NiroLearn؟</h2>
          <p>ثلاث خطوات من الملف إلى المذاكرة.</p>
        </div>
        <ol className={s.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={s.step}>
              <span className={s.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Study method ─────────────────────────────────────────── */}
      <section
        id="study-method"
        className={s.section}
        aria-labelledby="method-title"
      >
        <div className={s.sectionHead}>
          <h2 id="method-title">كيف تذاكر ملفًا كبيرًا للامتحان؟</h2>
          <p>
            أفضل طريقة للمذاكرة تجمع مبدأين من أكثر طرق التعلّم فاعلية في أبحاث
            التعلّم: الاسترجاع النشط والتكرار المتباعد. هكذا يطبّقهما NiroLearn
            على ملفك:
          </p>
        </div>
        <ol className={s.method}>
          {METHOD.map(item => (
            <li key={item.title} className={s.methodItem}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
        <p className={s.moreLink}>
          <Link href="/how-to-study">اقرأ خطة المذاكرة كاملة في ست خطوات</Link>
        </p>
      </section>

      {/* ── Exam Focus ───────────────────────────────────────────── */}
      <section
        id="exam-focus"
        className={s.focusBand}
        aria-labelledby="focus-title"
      >
        <div className={s.focusInner}>
          <div className={s.focusCopy}>
            <h2 id="focus-title">
              Exam Focus: أهم ما في المادة، من الملف كاملًا
            </h2>
            <p>
              بدل أن تقرأ كل الصفحات بالأهمية نفسها، يمرّ Exam Focus على كامل
              الملف ويستخرج المعلومات عالية الأهمية في بطاقات قصيرة، مصنّفة حسب
              نوعها: لازم تعرفها، ومهمة جدًا، وفخ امتحان، وأرقام وحدود، ومقارنة،
              وغيرها.
            </p>
            <ul className={s.focusPoints}>
              <li>كل بطاقة تذكر الصفحات التي جاءت منها لترجع إليها.</li>
              <li>احفظ البطاقات التي تحتاج مراجعتها قبل الامتحان.</li>
              <li>أداة للتركيز لا بديل عن مادتك: راجع دائمًا مع المصدر.</li>
            </ul>
          </div>
          <figure className={s.focusStack}>
            {FOCUS_CARDS.map(card => (
              <div key={card.tag} className={s.focusCard}>
                <span className={s.focusTag}>{card.tag}</span>
                <p>{card.text}</p>
                <span className={s.focusSource}>صفحة 12</span>
              </div>
            ))}
            <figcaption className={s.caption}>
              مثال توضيحي بمحتوى تجريبي.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Features + product preview ───────────────────────────── */}
      <section
        id="features"
        className={s.section}
        aria-labelledby="features-title"
      >
        <div className={s.sectionHead}>
          <h2 id="features-title">كل أدوات المذاكرة في مكان واحد</h2>
          <p>
            بدل أداة للتلخيص وأخرى للبطاقات وثالثة للخرائط الذهنية، كل أداة هنا
            تُبنى من ملفك أنت، فتذاكر المحتوى الذي ستُمتحن فيه.
          </p>
        </div>

        <div className={s.features}>
          <Feature
            title="تلخيص PDF منظم"
            href="/pdf-summary"
            text="ملخص شامل لكل جزء من الكتاب أو المحاضرة، مرتّب بعناوين ونقاط تقرأه في دقائق. وفي المواد الإنجليزية يصلك معه شرح عربي مساند."
            preview={<SummaryPreview />}
          />
          <Feature
            title="فلاش كارد بمراجعة متباعدة"
            href="/flashcards"
            text="بطاقات سؤال وجواب من محتوى ملفك، تعود إليك في موعدها حسب تقييمك لكل بطاقة."
            preview={<FlashcardPreview />}
          />
          <Feature
            title="اختبارات من ملفك"
            text="أسئلة اختيار من متعدد مبنية على محتوى الملف، مع شرح لكل إجابة."
            preview={<QuizPreview />}
          />
          <Feature
            title="خريطة ذهنية بالذكاء الاصطناعي"
            href="/mind-map"
            text="خريطة ذهنية لكل جزء من ملفك، بمفاهيمه وأهم نقاطه للامتحان، لترى كيف ترتبط الأفكار ببعضها."
            preview={<MindMapPreview />}
          />
          <Feature
            title="Niro، مساعدك في الدراسة"
            text="حدّد فقرة أو اكتب سؤالك، ويشرح لك Niro بالاعتماد على صفحات ملفك."
            preview={<AssistantPreview />}
          />
        </div>

        <div className={s.alsoRow}>
          <h3>وأيضًا</h3>
          <ul>
            <li>قارئ PDF مع تظليل وملاحظات على الصفحات.</li>
            <li>
              <Link href={PAST_QUESTIONS_PATH}>
                حوّل ملف أسئلة السنوات السابقة
              </Link>{" "}
              إلى اختبار تفاعلي مع شرح.
            </li>
            <li>
              <Link href={SOLVE_QUESTIONS_PATH}>
                حل أسئلة ملف PDF بالذكاء الاصطناعي
              </Link>{" "}
              مع شرح كل إجابة.
            </li>
            <li>
              <Link href={BOT_PAGE_PATH}>بوت Telegram</Link>: أرسل الملف وافتح
              أسئلته من هاتفك.
            </li>
            <li>شارك حزمة مذاكرة مع زملائك.</li>
            <li>ألعاب مراجعة سريعة مع Niro.</li>
          </ul>
        </div>
        <p className={s.caption}>
          المعاينات أمثلة توضيحية بمحتوى تجريبي من واجهة NiroLearn.
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <section className={s.section} aria-labelledby="faq-title">
        <div className={s.sectionHead}>
          <h2 id="faq-title">أسئلة شائعة</h2>
        </div>
        <div className={s.faq}>
          {LANDING_FAQ.map(item => (
            <details key={item.q} className={s.faqItem}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────── */}
      <section className={s.cta} aria-labelledby="cta-title">
        <NiroCharacter
          expression="victory"
          size={132}
          animated={false}
          className={s.ctaNiro}
        />
        <div>
          <h2 id="cta-title">جاهز تبدأ دراسة أذكى؟</h2>
          <p>ارفع أول ملف لك مجانًا، وشاهد كيف يتحوّل إلى مذاكرة منظمة.</p>
          <Link href="/register" className={s.primary}>
            ابدأ مجانًا
          </Link>
        </div>
      </section>
    </MarketingPage>
  );
}

function Feature({
  title,
  text,
  preview,
  href,
}: {
  title: string;
  text: string;
  preview: React.ReactNode;
  href?: string;
}) {
  return (
    <article className={s.feature}>
      <div className={s.featureCopy}>
        <h3>{title}</h3>
        <p>{text}</p>
        {href ? (
          <Link href={href} className={s.featureLink}>
            المزيد عن {title}
          </Link>
        ) : null}
      </div>
      <div className={s.preview} aria-hidden="true">
        {preview}
      </div>
    </article>
  );
}

// The signature moment: a lecture page with the exam-relevant lines marked,
// and what NiroLearn makes from it. Decorative; the heading carries meaning.
function HeroSheet() {
  return (
    <div className={s.heroVisual} aria-hidden="true">
      <div className={s.sheet}>
        <div className={s.sheetHead}>
          <span>محاضرة 3 · الخلية العصبية</span>
          <span>صفحة 12</span>
        </div>
        <p className={s.sheetText}>
          تنقل الخلايا العصبية الإشارات الكهربائية على طول{" "}
          <mark className={s.mark}>المحور العصبي بعيدًا عن جسم الخلية</mark>.
          ويبلغ{" "}
          <mark className={`${s.mark} ${s.markDelay1}`}>
            جهد الراحة للغشاء نحو {MINUS_70} ملي فولت
          </mark>
          ، وتحافظ عليه{" "}
          <mark className={`${s.mark} ${s.markDelay2}`}>
            مضخة الصوديوم والبوتاسيوم
          </mark>{" "}
          التي تنقل الأيونات عكس تدرّج تركيزها، مستهلكةً الطاقة في كل دورة.
        </p>
        <div className={s.sheetLines}>
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className={s.outputs}>
        <div className={s.outCard}>
          <span className={s.focusTag}>Exam Focus · أرقام وحدود</span>
          <p>جهد الراحة نحو {MINUS_70} ملي فولت</p>
        </div>
        <div className={s.outChips}>
          <span>ملخص</span>
          <span>بطاقات</span>
          <span>اختبار</span>
          <span>خريطة ذهنية</span>
        </div>
      </div>

      <NiroCharacter
        expression="explaining"
        size={150}
        animated={false}
        className={s.heroNiro}
      />
    </div>
  );
}
