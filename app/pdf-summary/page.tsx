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
import {
  AfterSummary,
  LecturePage,
} from "@/components/landing/Transformations";
import s from "@/components/landing/landing.module.css";
import { SummaryReel } from "@/components/landing/Reels";
import { TogetherBand } from "@/components/landing/Showcase";
import { BASE_OPEN_GRAPH } from "@/lib/site";

// Targets the PDF-summary cluster (OpenSEO, Saudi market, 2026-09):
// "تلخيص ملف pdf" 260/mo, "تلخيص pdf بالذكاء الاصطناعي" 110, "موقع تلخيص"
// 70, "تلخيص كتاب pdf" 50, "موقع تلخيص ملفات pdf عربي" 40, "تلخيص
// المحاضرات" 30. Ranking pages are generic PDF tools; this page's angle is
// summarizing *for studying*.
const TITLE = "تلخيص ملفات PDF بالذكاء الاصطناعي للمذاكرة | NiroLearn";
const DESCRIPTION =
  "لخّص كتابك أو محاضرتك PDF بالذكاء الاصطناعي: ملخص منظم لكل جزء، وشرح عربي مساند للمواد الإنجليزية، وأهم معلومات الامتحان مع أرقام الصفحات. ابدأ مجانًا.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pdf-summary" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/pdf-summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQ: FaqItem[] = [
  {
    q: "كيف ألخّص ملف PDF بالذكاء الاصطناعي؟",
    a: "أنشئ حسابًا مجانيًا في NiroLearn وارفع ملف PDF لكتابك أو محاضرتك. يقرأ NiroLearn الملف كاملًا ويقسّمه إلى أجزاء، ثم تفتح ملخص كل جزء بعناوينه ونقاطه، ومعه Exam Focus والبطاقات والاختبارات من المحتوى نفسه.",
  },
  {
    q: "هل يلخّص ملفات PDF بالعربي؟",
    a: "نعم. الواجهة بالعربية، ويمكنك رفع ملفات بالعربية أو بالإنجليزية. في المواد الإنجليزية، مثل الطب والهندسة، يبقى الشرح بمصطلحات مادتك الأصلية ومعه شرح عربي مساند وقائمة بأهم المصطلحات بالعربية والإنجليزية.",
  },
  {
    q: "هل يقرأ الملفات المصوّرة (الممسوحة ضوئيًا)؟",
    a: "نعم، يقرأ NiroLearn النص حتى من الصفحات المصوّرة، مثل المحاضرات المطبوعة التي صوّرتها.",
  },
  {
    q: "هل يمكن تلخيص كتاب PDF كامل؟",
    a: "نعم، يقرأ NiroLearn الملف كاملًا ويقسّمه إلى أجزاء تذاكرها بالترتيب. عدد الملفات وأقصى حجم للملف يعتمدان على باقتك، والتفاصيل في صفحة الأسعار.",
  },
  {
    q: "هل تلخيص PDF مجاني؟",
    a: "يمكنك البدء بالباقة المجانية دون بطاقة دفع، وهي تشمل الملخصات وباقي أدوات المذاكرة بحدود استخدام أقل. باقتا Pro وUltimate ترفعان الحدود.",
  },
];

export default function PdfSummaryPage() {
  return (
    <MarketingPage current="/pdf-summary">
      <PageJsonLd
        path="/pdf-summary"
        name="تلخيص ملفات PDF بالذكاء الاصطناعي للمذاكرة"
        description={DESCRIPTION}
        faq={FAQ}
      />
      <ToolHero
        title="تلخيص ملفات PDF بالذكاء الاصطناعي، للمذاكرة لا للقراءة فقط"
        lede={
          <p>
            ارفع كتابك أو محاضرتك بصيغة PDF، واحصل على ملخص منظم لكل جزء بعناوين
            ونقاط، وأهم معلومات الامتحان مع رقم الصفحة، ثم حوّل الملخص نفسه إلى
            فلاش كارد واختبارات.
          </p>
        }
        figure={
          <BeforeAfter
            before={<LecturePage />}
            after={<AfterSummary />}
            caption="مثال توضيحي بمحتوى تجريبي: صفحة من محاضرة إنجليزية، وملخصها في NiroLearn. اسحب الخط للمقارنة."
          />
        }
      />

      <Section
        id="what"
        title="ماذا تحصل عليه من ملف PDF واحد؟"
        intro="الملخص بداية المذاكرة لا نهايتها، لذلك يبني NiroLearn حوله ما تحتاجه للامتحان."
      >
        <div className={s.prose}>
          <ul>
            <li>
              <strong>ملخص منظم لكل جزء</strong> من الكتاب أو المحاضرة، بعناوين
              ونقاط تقرأه في دقائق بدل إعادة قراءة الصفحات.
            </li>
            <li>
              <strong>شرح عربي مساند للمواد الإنجليزية</strong>، مع بقاء
              المصطلحات الأصلية كما في مادتك، وقائمة بأهم المصطلحات بالعربية
              والإنجليزية.
            </li>
            <li>
              <strong>Exam Focus</strong>: المعلومات عالية الأهمية من الملف
              كاملًا، مصنّفة حسب نوعها، وكل منها يذكر الصفحة التي جاء منها.
            </li>
            <li>
              <strong>فلاش كارد واختبارات</strong> من المحتوى نفسه، لتختبر نفسك
              بعد القراءة.
            </li>
            <li>
              <strong>الملفات المصوّرة</strong> مدعومة، فيُقرأ النص حتى من
              المحاضرات المطبوعة التي صوّرتها.
            </li>
          </ul>
        </div>
      </Section>

      <Section
        id="watch"
        title="شاهد كيف يعمل"
        intro="من الملف إلى ملخص منظم في ثلاثة مشاهد."
      >
        <SummaryReel />
      </Section>

      <Section id="steps" title="كيف تلخّص ملف PDF في NiroLearn؟">
        <ol className={s.steps}>
          <li className={s.step}>
            <span className={s.stepNumber} aria-hidden="true">
              1
            </span>
            <h3>ارفع الملف</h3>
            <p>
              كتاب، أو محاضرة، أو ملف أسئلة بصيغة PDF، بالعربية أو بالإنجليزية.
            </p>
          </li>
          <li className={s.step}>
            <span className={s.stepNumber} aria-hidden="true">
              2
            </span>
            <h3>يقسّمه NiroLearn إلى أجزاء</h3>
            <p>
              يقرأ كل الصفحات ويقسّم الملف الطويل إلى أجزاء واضحة تذاكرها
              بالترتيب.
            </p>
          </li>
          <li className={s.step}>
            <span className={s.stepNumber} aria-hidden="true">
              3
            </span>
            <h3>افتح ملخص كل جزء</h3>
            <p>
              اقرأ الملخص، ثم انتقل من الجزء نفسه إلى Exam Focus والبطاقات
              والاختبار.
            </p>
          </li>
        </ol>
      </Section>

      <Section
        id="compare"
        title="ما الفرق بين NiroLearn وأدوات تلخيص PDF العامة؟"
        intro="أدوات التلخيص العامة مفيدة لقراءة مستند بسرعة. المذاكرة للامتحان تحتاج أكثر من ملخص واحد."
      >
        <div className={s.tableWrap}>
          <table className={s.compareTable}>
            <thead>
              <tr>
                <th scope="col">ما تحتاجه للمذاكرة</th>
                <th scope="col">أداة تلخيص PDF عامة</th>
                <th scope="col">NiroLearn</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">ملف طويل من مئات الصفحات</th>
                <td>ملخص للمستند غالبًا</td>
                <td>أجزاء واضحة، وملخص لكل جزء تذاكره بالترتيب</td>
              </tr>
              <tr>
                <th scope="row">معرفة المهم للامتحان</th>
                <td>تستنتجه بنفسك من الملخص</td>
                <td>Exam Focus من الملف كاملًا، مع رقم الصفحة</td>
              </tr>
              <tr>
                <th scope="row">مادة بالإنجليزية</th>
                <td>ملخص بلغة واحدة</td>
                <td>شرح بالمصطلحات الأصلية، ومعه شرح عربي مساند</td>
              </tr>
              <tr>
                <th scope="row">تثبيت المعلومة</th>
                <td>أداة أخرى للبطاقات أو الأسئلة</td>
                <td>فلاش كارد واختبارات من الملف نفسه، بمراجعة متباعدة</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <TogetherBand />
      <FaqSection items={FAQ} />
      <RelatedPages current="/pdf-summary" />
      <CtaBand
        title="لخّص أول ملف لك مجانًا"
        text="ارفع محاضرة أو فصلًا من كتابك، وشاهد ملخصه وأهم معلومات الامتحان فيه."
      />
    </MarketingPage>
  );
}
