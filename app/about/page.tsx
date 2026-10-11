import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { BASE_OPEN_GRAPH } from "@/lib/site";
import LegalPage, {
  LEGAL_APP_NAME,
  LEGAL_CONTACT_EMAIL,
  type LegalSection,
} from "@/components/legal/LegalPage";

// Public "about" page (linked from the landing footer): what NiroLearn is,
// what it does and how it is paid for — only what is true of the product
// as it runs. Nothing about people or places that the site does not state
// elsewhere.
const description = `${LEGAL_APP_NAME} منصة مذاكرة عربية: ترفع ملفك الدراسي فتحصل على ملخص، بطاقات مراجعة، أسئلة مشروحة وخريطة ذهنية، وتذاكر مع زملائك في غرف دراسة.`;

export const metadata: Metadata = {
  title: `من نحن | ${LEGAL_APP_NAME}`,
  description,
  alternates: { canonical: "/about" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/about",
    title: `من نحن | ${LEGAL_APP_NAME}`,
    description,
  },
};

const sections: LegalSection[] = [
  {
    id: "what",
    title: `ما هو ${LEGAL_APP_NAME}؟`,
    body: (
      <>
        <p>
          {LEGAL_APP_NAME} منصة مذاكرة باللغة العربية لطلاب الجامعات والثانوية.
          فكرتها بسيطة: الطالب يملك المادة أصلًا — كتاب، ملزمة، أو ملف أسئلة
          سنوات سابقة — وما ينقصه هو الوقت لتحويلها إلى مذاكرة منظّمة. ترفع
          الملف، ويتولى {LEGAL_APP_NAME} تقسيمه إلى أجزاء وتجهيز أدوات المراجعة
          لكل جزء.
        </p>
        <p>
          المنصة تعمل من المتصفح على الهاتف والحاسوب، ومن داخل Telegram عبر بوت
          خاص، دون تنزيل أي برنامج.
        </p>
      </>
    ),
  },
  {
    id: "does",
    title: "ماذا يفعل؟",
    body: (
      <ul>
        <li>
          <strong>تلخيص الملفات:</strong> ملخص لكل فصل أو جزء من ملف PDF، بلغة
          المادة مع شرح عربي عند الحاجة. التفاصيل في{" "}
          <Link href="/pdf-summary">صفحة تلخيص PDF</Link>.
        </li>
        <li>
          <strong>بطاقات المراجعة:</strong> بطاقات سؤال وجواب تعود إليك في
          مواعيد محسوبة حتى تثبت المعلومة. انظر{" "}
          <Link href="/flashcards">الفلاش كارد</Link>.
        </li>
        <li>
          <strong>ملفات الأسئلة:</strong> تحويل ملف أسئلة جاهز إلى اختبار تفاعلي
          مع شرح لكل سؤال. انظر <Link href="/solve-questions">حل الأسئلة</Link>{" "}
          و<Link href="/past-exam-questions">أسئلة السنوات السابقة</Link>.
        </li>
        <li>
          <strong>الخريطة الذهنية:</strong> صورة واحدة لبنية الفصل وعلاقة
          أفكاره. انظر <Link href="/mind-map">الخريطة الذهنية</Link>.
        </li>
        <li>
          <strong>غرف الدراسة:</strong> غرفة خاصة أو عامة تفتح فيها ملفًا أو
          فيديو مع زملائك، بمحادثة نصية وصوتية واختبار جماعي.
        </li>
        <li>
          <strong>اختبارات جاهزة:</strong> اختبارات قصيرة في المعلومات العامة
          والعلوم والجغرافيا والتاريخ وغيرها، تدرسها وحدك أو تلعبها مع أصدقائك.
        </li>
      </ul>
    ),
  },
  {
    id: "how",
    title: "كيف نتعامل مع ملفاتك؟",
    body: (
      <>
        <p>
          ملفاتك لك. لا تظهر لطالب آخر إلا إذا شاركتها أنت معه، ويمكنك حذف أي
          ملف أو حذف حسابك كله من صفحة الحساب في أي وقت. المحتوى الذي يولّده
          الذكاء الاصطناعي مبنيّ على نص ملفك نفسه، وقد يخطئ؛ لذلك يبقى الملف
          الأصلي مرجعك دائمًا.
        </p>
        <p>
          كل ما نجمعه ولماذا مكتوب في{" "}
          <Link href="/privacy">سياسة الخصوصية</Link>، وشروط الاستخدام في{" "}
          <Link href="/terms">سياسة الاستخدام</Link>.
        </p>
      </>
    ),
  },
  {
    id: "money",
    title: "كيف تُموَّل المنصة؟",
    body: (
      <p>
        للمنصة باقة مجانية بحدود معلنة، وباقات مدفوعة بحدود أعلى وبلا إعلانات؛
        تفاصيلها في <Link href="/pricing">صفحة الأسعار</Link>. قد تظهر
        للمستخدمين على الباقة المجانية إعلانات، وهي ما يبقي الباقة المجانية
        متاحة.
      </p>
    ),
  },
  {
    id: "contact",
    title: "تواصل معنا",
    body: (
      <p>
        لأي سؤال أو اقتراح أو ملاحظة على المحتوى راسلنا على{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} dir="ltr">
          {LEGAL_CONTACT_EMAIL}
        </a>
        ، أو من <Link href="/contact">صفحة التواصل</Link>.
      </p>
    ),
  },
];

export default function AboutPage() {
  return (
    <LegalPage
      title="من نحن"
      intro={<p>{description}</p>}
      sections={sections}
    />
  );
}
