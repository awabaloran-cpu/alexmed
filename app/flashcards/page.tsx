import type { Metadata } from "next";
import BeforeAfter from "@/components/landing/BeforeAfter";
import FlipCard from "@/components/landing/FlipCard";
import {
  CtaBand,
  FaqSection,
  PageJsonLd,
  RelatedPages,
  Section,
  ToolHero,
  type FaqItem,
} from "@/components/landing/PageBits";
import { MarketingPage } from "@/components/landing/SiteChrome";
import { AfterDeck, LecturePage } from "@/components/landing/Transformations";
import s from "@/components/landing/landing.module.css";
import { FlashcardsReel } from "@/components/landing/Reels";
import { TogetherBand } from "@/components/landing/Showcase";
import { BASE_OPEN_GRAPH } from "@/lib/site";

// Targets "فلاش كارد" (320/mo, KD 0 — Saudi SERP is Canva templates, store
// apps and physical cards), "بطاقات تعليمية" (70) and "التكرار المتباعد"
// (70). Angle: cards made from your own file, scheduled for you.
const TITLE = "فلاش كارد بالذكاء الاصطناعي من ملفاتك | NiroLearn";
const DESCRIPTION =
  "حوّل كتابك أو محاضرتك PDF إلى فلاش كارد بالذكاء الاصطناعي، تعود إليك بالتكرار المتباعد حسب تقييمك لكل بطاقة. بطاقات تعليمية من ملفك أنت، ابدأ مجانًا.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/flashcards" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/flashcards",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "كيف أعمل فلاش كارد من ملف PDF؟",
    a: "ارفع ملف PDF لكتابك أو محاضرتك في NiroLearn، فيقسّمه إلى أجزاء ويصنع من كل جزء بطاقات سؤال وجواب من محتواه. تراجع البطاقات وتقيّم كل واحدة، فتعود إليك في موعدها.",
  },
  {
    q: "ما هو التكرار المتباعد؟",
    a: "طريقة مراجعة تعيد لك المعلومة قبل أن تنساها بقليل، على فترات تطول كلما تذكّرتها. بطاقات NiroLearn تُجدوَل بهذه الطريقة حسب تقييمك لكل بطاقة.",
  },
  {
    q: "هل البطاقات بالعربي؟",
    a: "نعم. وفي المواد الإنجليزية تكون البطاقات بالعربية والإنجليزية معًا، لتحفظ المصطلح كما سيأتي في الامتحان وتفهم معناه بالعربية.",
  },
  {
    q: "هل أستطيع تحويل أسئلة سنوات سابقة إلى بطاقات؟",
    a: "نعم. ارفع ملف الأسئلة السابقة، ويحوّله NiroLearn إلى بطاقات مراجعة.",
  },
  {
    q: "ما الفرق بين الفلاش كارد والاختبارات في NiroLearn؟",
    a: "البطاقة تطلب منك أن تتذكّر الإجابة بنفسك ثم تقيّم تذكّرك، والاختبار يعطيك أسئلة اختيار من متعدد مع شرح لكل إجابة. الاثنان من محتوى ملفك.",
  },
];

export default function FlashcardsPage() {
  return (
    <MarketingPage current="/flashcards">
      <PageJsonLd
        path="/flashcards"
        name="فلاش كارد بالذكاء الاصطناعي من ملفاتك"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <ToolHero
        title="فلاش كارد بالذكاء الاصطناعي من ملفاتك، تعود إليك في موعدها"
        lede={
          <p>
            لا تكتب البطاقات بيدك. ارفع ملف PDF، ويصنع NiroLearn من كل جزء
            بطاقات سؤال وجواب من محتواه، ثم يجدولها بالتكرار المتباعد حسب تقييمك
            لكل بطاقة.
          </p>
        }
        figure={
          <BeforeAfter
            before={<LecturePage />}
            after={<AfterDeck />}
            caption="مثال توضيحي بمحتوى تجريبي: صفحة من محاضرة، والبطاقات المصنوعة منها. اسحب الخط للمقارنة."
          />
        }
      />

      <Section
        id="try"
        title="جرّب بطاقة الآن"
        intro="هكذا تعمل المراجعة: تتذكّر أولًا، ثم ترى الإجابة."
      >
        <div className={s.tryCard}>
          <FlipCard
            question="ماذا تفعل مضخة الصوديوم والبوتاسيوم في كل دورة؟"
            answer="تُخرج 3 أيونات صوديوم وتُدخل 2 بوتاسيوم، فتحافظ على جهد الراحة."
          />
          <div className={s.prose}>
            <p>
              محاولة التذكّر قبل رؤية الإجابة اسمها{" "}
              <strong>الاسترجاع النشط</strong>، وهي من أكثر طرق المذاكرة فاعلية
              في أبحاث التعلّم، أكثر من إعادة القراءة أو التظليل وحده.
            </p>
            <p>
              بعد كل بطاقة تقيّم تذكّرك لها. البطاقة التي نسيتها تعود قريبًا،
              والتي تعرفها جيدًا تبتعد، فيذهب وقت المراجعة إلى ما يحتاجه فعلًا.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="watch"
        title="شاهد كيف يعمل"
        intro="من الصفحة إلى بطاقة تعود إليك في موعدها."
      >
        <FlashcardsReel />
      </Section>

      <Section id="why" title="لماذا بطاقات من ملفك أنت؟">
        <div className={s.prose}>
          <ul>
            <li>
              <strong>من المحتوى الذي ستُمتحن فيه</strong>، لا من مجموعات جاهزة
              كتبها غيرك لمنهج آخر.
            </li>
            <li>
              <strong>من كل أجزاء الملف</strong>، فلا تضيع ساعات في كتابة
              البطاقات بيدك.
            </li>
            <li>
              <strong>بالعربية والإنجليزية معًا</strong> في المواد الإنجليزية،
              لتحفظ المصطلح وتفهمه.
            </li>
            <li>
              <strong>من أسئلة السنوات السابقة</strong> أيضًا، إذا رفعت ملف
              الأسئلة.
            </li>
          </ul>
        </div>
      </Section>

      <TogetherBand />
      <FaqSection items={FAQ} />
      <RelatedPages current="/flashcards" />
      <CtaBand
        title="اصنع أول فلاش كارد من ملفك"
        text="ارفع محاضرة واحدة مجانًا، وراجع بطاقاتها اليوم."
      />
    </MarketingPage>
  );
}
