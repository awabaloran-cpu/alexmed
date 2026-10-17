import type { Metadata } from "next";
import {
  CtaBand,
  FaqSection,
  PageJsonLd,
  RelatedPages,
  Section,
  ToolHero,
  type FaqItem,
} from "@/components/landing/PageBits";
import { RoomsReel } from "@/components/landing/Reels";
import {
  PlayStepsSection,
  RoomsSection,
  WatchTogetherSection,
} from "@/components/landing/Showcase";
import { MarketingPage } from "@/components/landing/SiteChrome";
import s from "@/components/landing/landing.module.css";
import { ROOM_CAPACITY_MAX, ROOM_CAPACITY_MIN } from "@/lib/study-rooms/config";
import { BASE_OPEN_GRAPH, ROOMS_PAGE_PATH } from "@/lib/site";

// Targets what students type to study together online — "غرف مذاكرة",
// "مذاكرة جماعية اونلاين", "غرفة مذاكرة اونلاين", "مذاكرة مع الاصدقاء" —
// and says plainly what the rooms are, for search and for AI answers:
// free, voice, one shared file with ink, YouTube together, group quizzes.
const TITLE = "غرف مذاكرة جماعية أونلاين مجانية | NiroLearn";
const DESCRIPTION =
  "ذاكر مع أصحابك أونلاين مجانًا: غرفة بالصوت ورفع اليد، وملف PDF مشترك تكتبون عليه بالقلم والتظليل، ومشاهدة شرح يوتيوب معًا، واختبارات جماعية بالنقاط.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROOMS_PAGE_PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: ROOMS_PAGE_PATH,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "هل غرف المذاكرة مجانية؟",
    a: "نعم، غرف المذاكرة في NiroLearn مجانية. أنشئ حسابًا مجانيًا برقم هاتفك، وافتح غرفة، وادعُ أصدقاءك برابطها.",
  },
  {
    q: "كم شخصًا يدخل الغرفة؟",
    a: `من ${ROOM_CAPACITY_MIN} إلى ${ROOM_CAPACITY_MAX} عضوًا، يختار العدد من ينشئ الغرفة.`,
  },
  {
    q: "ما الفرق بين الغرفة الخاصة والعامة؟",
    a: "الغرفة الخاصة لأصحابك بالرابط فقط. الغرفة العامة تظهر في قسم تخصصها فيجدها أي طالب ويدخلها. ويمكن جعل الغرفة للطالبات فقط.",
  },
  {
    q: "ماذا نفعل في الغرفة؟",
    a: "تتكلّمون بالصوت ويرفع من عنده سؤال يده، ويعرض القائد ملف PDF للجميع فتكتبون عليه بالقلم وقلم التحديد، أو يشغّل فيديو يوتيوب يُشاهَد معًا، وتتحدثون في محادثة تعرف الصفحة ولحظة الفيديو، ثم تلعبون اختبارًا جماعيًا.",
  },
  {
    q: "كيف نشاهد فيديو يوتيوب معًا؟",
    a: "يلصق القائد رابط الفيديو في الغرفة، فيُشغَّل للجميع في نفس اللحظة ويتوقّف معًا حين يوقفه، والصوت مفتوح للنقاش أثناء المشاهدة.",
  },
  {
    q: "هل تعمل الغرف على الجوال؟",
    a: "نعم، من متصفح الجوال أو الكمبيوتر، وتبقى الغرفة معك وأنت تتنقّل بين صفحات الموقع.",
  },
];

const START = [
  {
    title: "افتح غرفة",
    text: "خاصة لأصحابك بالرابط، أو عامة في قسم تخصصك.",
  },
  {
    title: "ادعُ أصحابك",
    text: "شارك الرابط في واتساب أو تيليجرام، أو ادعُ زملاءك من داخل الموقع.",
  },
  {
    title: "اختر ملفًا أو فيديو",
    text: "ملف PDF من مكتبتك يراه الجميع، أو شرح يوتيوب تشاهدونه معًا.",
  },
  {
    title: "ذاكروا والعبوا",
    text: "تكلّموا، واكتبوا على الصفحة، واختموا باختبار جماعي.",
  },
] as const;

export default function StudyRoomsPage() {
  return (
    <MarketingPage current={ROOMS_PAGE_PATH}>
      <PageJsonLd
        path={ROOMS_PAGE_PATH}
        name="غرف مذاكرة جماعية أونلاين مجانية"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <ToolHero
        title="غرف مذاكرة جماعية أونلاين، مجانًا مع أصحابك"
        lede={
          <p>
            غرفة واحدة فيها الصوت، والملف أمام الجميع بأقلام وتظليل، وشرح يوتيوب
            تشاهدونه معًا، ومحادثة، واختبارات جماعية. ادخل من الجوال أو
            الكمبيوتر، دون تطبيق إضافي.
          </p>
        }
        figure={<RoomsReel />}
      />

      <Section
        id="start"
        title="ابدأ غرفتك في دقيقة"
        intro="أربع خطوات من الفكرة إلى الجلسة."
      >
        <ol className={s.steps}>
          {START.map((step, index) => (
            <li key={step.title} className={s.step}>
              <span className={s.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <RoomsSection withLink={false} />
      <WatchTogetherSection />
      <PlayStepsSection />

      <FaqSection items={FAQ} />
      <RelatedPages current={ROOMS_PAGE_PATH} />
      <CtaBand
        title="افتح غرفتك الأولى مجانًا"
        text="أنشئ حسابًا برقم هاتفك، وادعُ أصحابك، وذاكروا معًا اليوم."
      />
    </MarketingPage>
  );
}
