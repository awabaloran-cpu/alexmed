import type { Metadata } from "next";
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
import { AfterMap, LecturePage } from "@/components/landing/Transformations";
import s from "@/components/landing/landing.module.css";
import { BASE_OPEN_GRAPH } from "@/lib/site";

// Targets "خريطة ذهنية" (1,900/mo, informational — people learning what a
// mind map is and how to make one), "خريطة ذهنية بالذكاء الاصطناعي" (50),
// "عمل خريطة ذهنية" (40). So the page teaches first, then shows the tool.
// The title answers the informational search first (Search Console,
// 2026-10: 26 impressions around position 8 and no click with the tool-led
// title).
const TITLE =
  "خريطة ذهنية: ما هي وكيف تعملها للمذاكرة بالذكاء الاصطناعي | NiroLearn";
const DESCRIPTION =
  "ما هي الخريطة الذهنية وكيف تعملها للمذاكرة؟ وكيف يبني NiroLearn خريطة ذهنية بالذكاء الاصطناعي لكل جزء من ملف PDF، بمفاهيمه وأهم نقاطه للامتحان.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/mind-map" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/mind-map",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "ما هي الخريطة الذهنية؟",
    a: "رسم يضع الفكرة الرئيسية في المنتصف، وتتفرّع منها الأفكار الفرعية ثم التفاصيل، فترى الموضوع كاملًا وكيف ترتبط أجزاؤه ببعضها في صفحة واحدة.",
  },
  {
    q: "كيف أعمل خريطة ذهنية بالذكاء الاصطناعي؟",
    a: "ارفع ملف PDF لمحاضرتك أو كتابك في NiroLearn، فيقسّمه إلى أجزاء ويبني لكل جزء خريطة ذهنية بأقسامه ومفاهيمه وأهم نقاطه للامتحان.",
  },
  {
    q: "هل الخريطة الذهنية بديل عن الملخص؟",
    a: "لا، هي تكمّله. الخريطة تعطيك الصورة الكاملة وترابط الأفكار، والملخص يعطيك التفاصيل. في NiroLearn تجد الاثنين لكل جزء من ملفك.",
  },
  {
    q: "هل تعمل مع المواد الإنجليزية؟",
    a: "نعم. تبقى المصطلحات بالإنجليزية كما في مادتك، ومعها شرح عربي مساند.",
  },
];

export default function MindMapPage() {
  return (
    <MarketingPage current="/mind-map">
      <PageJsonLd
        path="/mind-map"
        name="خريطة ذهنية بالذكاء الاصطناعي من ملف PDF"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <ToolHero
        title="خريطة ذهنية بالذكاء الاصطناعي لكل جزء من ملفك"
        lede={
          <p>
            ارفع ملف PDF، ويبني NiroLearn لكل جزء خريطة ذهنية بأقسامه ومفاهيمه
            وأهم نقاطه للامتحان، لترى الموضوع كاملًا قبل أن تدخل في التفاصيل.
          </p>
        }
        figure={
          <BeforeAfter
            before={<LecturePage />}
            after={<AfterMap />}
            caption="مثال توضيحي بمحتوى تجريبي: صفحة من محاضرة، والخريطة الذهنية المبنية منها. اسحب الخط للمقارنة."
          />
        }
      />

      <Section id="what" title="ما هي الخريطة الذهنية؟">
        <div className={s.prose}>
          <p>
            الخريطة الذهنية رسم يضع الفكرة الرئيسية في المنتصف، وتتفرّع منها
            الأفكار الفرعية ثم التفاصيل. قيمتها في المذاكرة أنها تريك الموضوع
            كاملًا في صفحة واحدة، وكيف ترتبط أجزاؤه ببعضها، بدل صفحات متتالية
            تقرأها واحدة بعد الأخرى.
          </p>
          <p>
            تفيدك في بداية المذاكرة لتعرف أين يقع كل جزء، وفي نهايتها لتختبر
            نفسك: هل تستطيع أن تشرح كل فرع دون أن تنظر إلى التفاصيل؟
          </p>
        </div>
      </Section>

      <Section
        id="how-to-make"
        title="كيف تعمل خريطة ذهنية للمذاكرة بنفسك؟"
        intro="إذا أردت أن ترسمها بيدك، هذه خطوات عملية:"
      >
        <ol className={s.method}>
          <li className={s.methodItem}>
            <h3>ضع عنوان الدرس في المنتصف</h3>
            <p>كلمة أو كلمتان فقط، مثل «الإشارة العصبية».</p>
          </li>
          <li className={s.methodItem}>
            <h3>أضف الفروع الرئيسية</h3>
            <p>عادةً هي عناوين الأقسام في المحاضرة، من ثلاثة إلى ستة فروع.</p>
          </li>
          <li className={s.methodItem}>
            <h3>اكتب تحت كل فرع ما يهم فقط</h3>
            <p>تعريفات، وأرقام، ومقارنات. كلمات قصيرة لا جمل كاملة.</p>
          </li>
          <li className={s.methodItem}>
            <h3>ميّز ما يأتي في الامتحان</h3>
            <p>ظلّل النقاط عالية الأهمية لتراجعها أولًا قبل الامتحان.</p>
          </li>
        </ol>
      </Section>

      <Section
        id="niro"
        title="كيف يبنيها NiroLearn من ملفك؟"
        intro="بدل أن ترسم خريطة لكل محاضرة بيدك، يبنيها NiroLearn لكل جزء من الملف."
      >
        <div className={s.prose}>
          <ul>
            <li>
              <strong>أقسام حقيقية</strong> من محتوى الجزء، لا عناوين عامة.
            </li>
            <li>
              <strong>مفاهيم كل قسم</strong> مع شرحها، وفي المواد الإنجليزية شرح
              عربي مساند.
            </li>
            <li>
              <strong>نقاط الامتحان عالية الأهمية</strong> مميّزة داخل كل قسم.
            </li>
            <li>
              <strong>أسئلة تذكّر</strong> مرتبطة بالأقسام، لتختبر نفسك بعد
              قراءة الخريطة.
            </li>
          </ul>
        </div>
      </Section>

      <FaqSection items={FAQ} />
      <RelatedPages current="/mind-map" />
      <CtaBand
        title="اصنع خريطة ذهنية لمحاضرتك القادمة"
        text="ارفع ملف PDF مجانًا، وشاهد الخريطة الذهنية لكل جزء منه."
      />
    </MarketingPage>
  );
}
