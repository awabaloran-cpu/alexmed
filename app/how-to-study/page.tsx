import type { Metadata } from "next";
import Link from "next/link";
import BeforeAfter from "@/components/landing/BeforeAfter";
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
import { AfterAll, LecturePage } from "@/components/landing/Transformations";
import s from "@/components/landing/landing.module.css";
import { MethodReel } from "@/components/landing/Reels";
import { TogetherBand } from "@/components/landing/Showcase";
import { BASE_OPEN_GRAPH } from "@/lib/site";

// Targets "كيف اذاكر" (260/mo) and "طريقة المذاكرة الصحيحة" (90), where the
// Saudi SERP is generic articles (mawdoo3, Quora) and an AI Overview. A
// practical, evidence-based method for one big file, with the tools linked.
const TITLE = "كيف أذاكر؟ طريقة المذاكرة الصحيحة لملف كبير | NiroLearn";
const DESCRIPTION =
  "طريقة مذاكرة عملية لكتاب أو محاضرة كبيرة قبل الامتحان: قسّم المادة، وابدأ بالصورة الكاملة، واختبر نفسك بالاسترجاع النشط، وراجع بالتكرار المتباعد.";
const PUBLISHED = "2026-09-28";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-to-study" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    type: "article",
    url: "/how-to-study",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "ما هي طريقة المذاكرة الصحيحة؟",
    a: "أن تفهم الصورة الكاملة أولًا، ثم تختبر نفسك بدل إعادة القراءة (الاسترجاع النشط)، وتراجع على فترات متباعدة بدل المذاكرة كلها في ليلة واحدة. هاتان الطريقتان من أكثر طرق المذاكرة فاعلية في أبحاث التعلّم.",
  },
  {
    q: "كيف أذاكر ولا أنسى؟",
    a: "راجع المعلومة على فترات تطول تدريجيًا، وفي كل مراجعة حاول أن تتذكّرها قبل أن تنظر إلى الإجابة. هذا ما تفعله الفلاش كارد المجدولة بالتكرار المتباعد.",
  },
  {
    q: "هل التظليل وإعادة القراءة مفيدان؟",
    a: "يفيدان قليلًا عند الاستخدام وحدهما، لأنهما يعطيان إحساسًا بالفهم دون أن تختبر تذكّرك فعلًا. استخدم التظليل لتحديد ما ستختبر نفسك فيه لاحقًا.",
  },
  {
    q: "كيف أعرف المهم في المادة للامتحان؟",
    a: "ابدأ بأسئلة السنوات السابقة إن وجدت، وبما يكرّره الأستاذ. وفي NiroLearn يجمع Exam Focus المعلومات عالية الأهمية من الملف كاملًا مع رقم الصفحة، لتراجعها مع المصدر.",
  },
];

const PLAN = [
  {
    title: "قسّم المادة إلى أجزاء صغيرة",
    body: "ملف من مئتي صفحة لا يُذاكر دفعة واحدة. قسّمه إلى أجزاء بحجم جلسة واحدة، وحدّد لكل يوم جزءًا أو اثنين قبل الامتحان بوقت كافٍ.",
    tool: "NiroLearn يقسّم الملف إلى أجزاء واضحة تلقائيًا.",
  },
  {
    title: "ابدأ بالصورة الكاملة",
    body: "قبل التفاصيل، اقرأ ملخصًا أو انظر إلى خريطة ذهنية للجزء: ما الفكرة الرئيسية؟ وما الفروع؟ هكذا تعرف أين تضع كل معلومة جديدة.",
    tool: "لكل جزء ملخص منظم وخريطة ذهنية.",
    link: { href: "/mind-map", label: "الخريطة الذهنية" },
  },
  {
    title: "حدّد ما يهم في الامتحان",
    body: "ليست كل الصفحات بالأهمية نفسها. التعريفات، والأرقام والحدود، والمقارنات، والنقاط التي يكرّرها الأستاذ تستحق وقتًا أكبر.",
    tool: "Exam Focus يجمعها من الملف كاملًا مع رقم الصفحة.",
  },
  {
    title: "اختبر نفسك بدل إعادة القراءة",
    body: "أغلق الكتاب وحاول أن تتذكّر: اشرح الفكرة بكلماتك، أو أجب عن سؤال، أو اقلب بطاقة. هذا الاسترجاع النشط يثبّت المعلومة أكثر من قراءتها مرة ثانية.",
    tool: "فلاش كارد واختبارات من محتوى الملف نفسه.",
    link: { href: "/flashcards", label: "الفلاش كارد" },
  },
  {
    title: "راجع على فترات متباعدة",
    body: "راجع الجزء بعد يوم، ثم بعد أيام، ثم بعد أسبوع. كل مراجعة ناجحة تبعد المراجعة التالية، والمعلومة التي نسيتها تعود قريبًا.",
    tool: "البطاقات تعود إليك في موعدها حسب تقييمك لها.",
  },
  {
    title: "تدرّب بأسئلة الامتحان",
    body: "في الأيام الأخيرة حلّ أسئلة سنوات سابقة في وقت محدد، وارجع إلى الأجزاء التي أخطأت فيها بدل مراجعة كل شيء بالتساوي.",
    tool: "حوّل ملف الأسئلة السابقة إلى بطاقات مراجعة.",
  },
] as const;

export default function HowToStudyPage() {
  return (
    <MarketingPage current="/how-to-study">
      <PageJsonLd
        path="/how-to-study"
        name="كيف أذاكر؟ طريقة المذاكرة الصحيحة لملف كبير قبل الامتحان"
        description={DESCRIPTION}
        faq={FAQ}
        article={{ datePublished: PUBLISHED }}
      />
      <ToolHero
        title="كيف أذاكر؟ طريقة المذاكرة الصحيحة لملف كبير قبل الامتحان"
        lede={
          <>
            <p>
              المشكلة غالبًا ليست في عدد ساعات المذاكرة، بل في طريقتها: إعادة
              قراءة الصفحات نفسها تعطي إحساسًا بالفهم، ثم تضيع المعلومة بعد
              أيام.
            </p>
            <p>
              هذه خطة من ست خطوات تعتمد على أكثر طرق التعلّم فاعلية في الأبحاث،
              تطبّقها بورقة وقلم، أو بأدوات NiroLearn على ملفك.
            </p>
          </>
        }
        figure={
          <BeforeAfter
            before={<LecturePage />}
            after={<AfterAll />}
            caption="مثال توضيحي بمحتوى تجريبي: صفحة من محاضرة، وما تذاكره منها في NiroLearn. اسحب الخط للمقارنة."
          />
        }
      />

      <Section
        id="watch"
        title="شاهد كيف يعمل"
        intro="طريقة المذاكرة في أربعة مشاهد."
      >
        <MethodReel />
      </Section>

      <Section id="plan" title="خطة المذاكرة في ست خطوات">
        <ol className={s.guide}>
          {PLAN.map(step => (
            <li key={step.title} className={s.guideStep}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <p className={s.guideTool}>
                في NiroLearn: {step.tool}
                {"link" in step ? (
                  <>
                    {" "}
                    <Link href={step.link.href}>{step.link.label}</Link>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="mistakes" title="أخطاء شائعة في المذاكرة">
        <div className={s.prose}>
          <ul>
            <li>
              <strong>إعادة القراءة وحدها:</strong> تشعر أنك تعرف المعلومة لأنها
              مألوفة، لكنك لم تختبر تذكّرها.
            </li>
            <li>
              <strong>تظليل كل شيء:</strong> إذا ظلّلت نصف الصفحة فلم تميّز
              شيئًا. ظلّل ما ستختبر نفسك فيه.
            </li>
            <li>
              <strong>المذاكرة كلها في الليلة الأخيرة:</strong> تنفع ليوم
              الامتحان ثم تُنسى بسرعة، والمراجعة المتباعدة تبقى أطول.
            </li>
            <li>
              <strong>مراجعة كل الأجزاء بالتساوي:</strong> أعطِ الوقت الأكبر لما
              نسيته أو أخطأت فيه.
            </li>
          </ul>
          <p className={s.source}>
            المرجع: Dunlosky وآخرون (2013)، «Improving Students’ Learning With
            Effective Learning Techniques»، مجلة Psychological Science in the
            Public Interest. قيّمت المراجعة الاختبار الذاتي والمراجعة المتباعدة
            بأنهما عاليتا الفائدة، وإعادة القراءة والتظليل بأنهما منخفضتا
            الفائدة عند استخدامهما وحدهما.
          </p>
        </div>
      </Section>

      <TogetherBand />
      <FaqSection items={FAQ} />
      <RelatedPages current="/how-to-study" />
      <CtaBand
        title="طبّق الخطة على ملفك الآن"
        text="ارفع محاضرة مجانًا، وابدأ بملخصها وExam Focus، ثم راجع بطاقاتها."
      />
    </MarketingPage>
  );
}
