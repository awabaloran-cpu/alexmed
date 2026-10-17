// JSON-LD for the landing page. Only schemas that describe NiroLearn as it
// is: the organization, the site, the web app with its free plan (paid
// prices live in the plans table and are left out so they can't drift),
// and the FAQ exactly as shown on the page.
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/LegalPage";
import {
  SITE_DESCRIPTION,
  SITE_ENTITY_DESCRIPTION_AR,
  SITE_ENTITY_IDS,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";
import { LANDING_FAQ } from "./Landing";

// "<" written as its JSON escape so no string value can close the tag.
const LT_ESCAPE = "\\" + "u003c";

export default function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": SITE_ENTITY_IDS.organization,
        name: SITE_NAME,
        alternateName: "نيـرو ليرن",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icon.svg`,
        email: LEGAL_CONTACT_EMAIL,
        description: SITE_ENTITY_DESCRIPTION_AR,
      },
      {
        "@type": "WebSite",
        "@id": SITE_ENTITY_IDS.website,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        inLanguage: "ar",
        publisher: { "@id": SITE_ENTITY_IDS.organization },
      },
      {
        "@type": ["SoftwareApplication", "WebApplication"],
        "@id": SITE_ENTITY_IDS.software,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web, Android",
        inLanguage: "ar",
        // What the product does today — the same list the page shows.
        featureList: [
          "تلخيص ملفات PDF (كتب ومحاضرات) في ملخص منظم لكل جزء",
          "Exam Focus: أهم معلومات الامتحان من الملف كاملًا مع أرقام الصفحات",
          "فلاش كارد بجدولة تكرار متباعد",
          "اختبارات اختيار من متعدد من محتوى الملف مع شرح لكل إجابة",
          "خريطة ذهنية لكل جزء من الملف",
          "مساعد دراسة يجيب بالاعتماد على صفحات الملف",
          "قارئ PDF مع تظليل وملاحظات",
          "تحويل ملفات الأسئلة السابقة إلى بطاقات مراجعة",
          "مشاركة حزمة مذاكرة مع الزملاء",
          "بوت تيليجرام: أرسل ملف PDF واحصل على أسئلة تفاعلية بشرح عربي",
          "غرف مذاكرة جماعية مجانية بالصوت ورفع اليد",
          "ملف PDF مشترك في الغرفة مع قلم وقلم تحديد وممحاة وتحديد بالحبل",
          "مشاهدة فيديو يوتيوب معًا في الغرفة بتشغيل متزامن",
          "اختبارات جماعية مع الأصدقاء بالنقاط ومنصة الفائزين",
          "مكتبة اختبارات جاهزة في أقسام وقنوات (استكشف)",
        ],
        audience: {
          "@type": "EducationalAudience",
          educationalRole: "student",
        },
        publisher: { "@id": SITE_ENTITY_IDS.organization },
        offers: {
          "@type": "Offer",
          name: "Free",
          price: "0",
          priceCurrency: "USD",
          url: `${SITE_URL}/pricing`,
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        inLanguage: "ar",
        mainEntity: LANDING_FAQ.map(item => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, LT_ESCAPE),
      }}
    />
  );
}
