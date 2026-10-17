import type { Metadata } from "next";
import {
  CtaBand,
  FaqSection,
  PageJsonLd,
  RelatedPages,
  ToolHero,
  type FaqItem,
} from "@/components/landing/PageBits";
import { GamesReel } from "@/components/landing/Reels";
import {
  DISCOVER_FACTS,
  DiscoverSection,
  PlayStepsSection,
} from "@/components/landing/Showcase";
import { MarketingPage } from "@/components/landing/SiteChrome";
import { BASE_OPEN_GRAPH, QUIZ_FRIENDS_PATH } from "@/lib/site";

// Targets group quiz play — "مسابقات اسئلة مع الاصدقاء", "لعبة اسئلة
// جماعية اونلاين", "اسئلة ثقافية" — and answers how it works, in the
// words a search engine or an AI answer can quote.
const TITLE = "اختبارات ومسابقات أسئلة تلعبها مع أصدقائك أونلاين | NiroLearn";
const DESCRIPTION = `العب مع أصدقائك اختبارات جاهزة في ${DISCOVER_FACTS.categories.length} قسمًا، أو أسئلة من ملفك: نفس السؤال للجميع في نفس اللحظة، والنقاط للأصح والأسرع، ومنصة فائزين. مجانًا في غرفة خاصة برابط.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: QUIZ_FRIENDS_PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: QUIZ_FRIENDS_PATH,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "كيف ألعب اختبارًا مع أصدقائي؟",
    a: "اختر اختبارًا من «استكشف» واضغط «العب مع الأصدقاء»، فتُفتح غرفة خاصة مجانًا. شارك رابطها، وحين يدخل أصدقاؤك اضغط «ابدأ اللعب الآن».",
  },
  {
    q: "كيف تُحسب النقاط؟",
    a: "يظهر السؤال نفسه للجميع في نفس اللحظة بعدّاد واحد، وتحصل الإجابة الصحيحة على نقاط أكثر كلما كانت أسرع. في النهاية تظهر منصة الفائزين.",
  },
  {
    q: "هل اللعب مجاني؟",
    a: "نعم، الغرف واللعب الجماعي مجانيان، وتجربة أي اختبار في صفحته مفتوحة دون تسجيل.",
  },
  {
    q: "ما الاختبارات المتاحة؟",
    a: `${DISCOVER_FACTS.quizzes} اختبارًا جاهزًا فيها ${DISCOVER_FACTS.questions} سؤالًا، في أقسام مثل المعلومات العامة والجغرافيا والتاريخ والعلوم والتكنولوجيا والصحة، بالعربية والإنجليزية. ويمكنك أيضًا اللعب بأسئلة ملفك أنت.`,
  },
  {
    q: "هل أستطيع اللعب وحدي؟",
    a: "نعم، بوضع «تعلّم» سؤالًا بسؤال مع نجوم حسب نتيجتك، أو بوضع «البطاقات» الذي تقلب فيه البطاقة وتسحبها.",
  },
];

export default function QuizWithFriendsPage() {
  return (
    <MarketingPage current={QUIZ_FRIENDS_PATH}>
      <PageJsonLd
        path={QUIZ_FRIENDS_PATH}
        name="اختبارات ومسابقات أسئلة مع الأصدقاء"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <ToolHero
        title="اختبارات ومسابقات أسئلة تلعبها مع أصدقائك"
        lede={
          <p>
            اختر اختبارًا جاهزًا أو أسئلة ملفك، وادعُ أصدقاءك برابط. نفس السؤال
            للجميع في نفس اللحظة، والنقاط للأصحّ والأسرع، وفي النهاية منصة
            الفائزين. مجانًا.
          </p>
        }
        figure={<GamesReel />}
      />
      <PlayStepsSection />
      <DiscoverSection withLink={false} />
      <FaqSection items={FAQ} />
      <RelatedPages current={QUIZ_FRIENDS_PATH} />
      <CtaBand
        title="العب أول اختبار مع أصدقائك"
        text="أنشئ حسابًا مجانيًا، واختر اختبارًا، وشارك الرابط."
      />
    </MarketingPage>
  );
}
