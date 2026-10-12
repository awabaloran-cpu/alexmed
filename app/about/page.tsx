import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import {
  FileText,
  Layers,
  ListChecks,
  Network,
  Sparkles,
  Users,
} from "lucide-react";
import { MarketingPage } from "@/components/landing/SiteChrome";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/LegalPage";
import NiroCharacter from "@/components/niro/NiroCharacter";
import { PUBLIC_QUIZZES, QUIZZES_PATH } from "@/lib/discover/public";
import { BASE_OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";
import s from "./about.module.css";

// Public "about" page (linked from the footer): what NiroLearn is, what it
// offers, what it holds to and who is behind it. Only what is true of the
// platform as it runs, and what its owner has stated: an Arabic platform
// and app, founded in 2026, made by the platform's own team (no names).
const FOUNDED = 2026;
const TITLE = `من نحن | ${SITE_NAME}`;
const DESCRIPTION = `${SITE_NAME} منصة وتطبيق عربي للمذاكرة تأسس عام ${FOUNDED}: ترفع ملفك الدراسي فتحصل على ملخص، بطاقات مراجعة، أسئلة مشروحة وخريطة ذهنية، وتذاكر مع زملائك في غرف دراسة.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/about",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const OFFER = [
  {
    icon: FileText,
    title: "تلخيص الملفات",
    text: "ملخص لكل فصل أو جزء من ملف PDF، بلغة المادة مع شرح عربي عند الحاجة.",
    href: "/pdf-summary",
    link: "تلخيص PDF",
  },
  {
    icon: Layers,
    title: "بطاقات المراجعة",
    text: "بطاقات سؤال وجواب تعود إليك في مواعيد محسوبة حتى تثبت المعلومة.",
    href: "/flashcards",
    link: "الفلاش كارد",
  },
  {
    icon: ListChecks,
    title: "ملفات الأسئلة",
    text: "تحويل ملف أسئلة جاهز أو أسئلة سنوات سابقة إلى اختبار تفاعلي مع شرح لكل سؤال.",
    href: "/solve-questions",
    link: "حل الأسئلة",
  },
  {
    icon: Network,
    title: "الخريطة الذهنية",
    text: "صورة واحدة لبنية الفصل وعلاقة أفكاره ببعضها، تراها قبل أن تبدأ التفاصيل.",
    href: "/mind-map",
    link: "الخريطة الذهنية",
  },
  {
    icon: Users,
    title: "غرف الدراسة",
    text: "غرفة خاصة أو عامة تفتح فيها ملفًا أو فيديو مع زملائك، بمحادثة نصية وصوتية واختبار جماعي.",
    href: "/register",
    link: "جرّبها بحساب مجاني",
  },
  {
    icon: Sparkles,
    title: "اختبارات جاهزة",
    text: `${PUBLIC_QUIZZES.length} اختبارًا في المعلومات العامة والعلوم والجغرافيا والتاريخ وغيرها، مفتوحة للقراءة واللعب دون تسجيل.`,
    href: QUIZZES_PATH,
    link: "تصفّح الاختبارات",
  },
] as const;

const email = (
  <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} dir="ltr">
    {LEGAL_CONTACT_EMAIL}
  </a>
);

export default function AboutPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/about`,
    inLanguage: "ar",
    mainEntity: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      foundingDate: String(FOUNDED),
      email: LEGAL_CONTACT_EMAIL,
      description: DESCRIPTION,
    },
  };
  return (
    <MarketingPage>
      <script
        type="application/ld+json"
        // Built from the constants above; no visitor input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={s.wrap}>
        <header className={s.hero}>
          <div className={s.heroText}>
            <span className={s.eyebrow}>من نحن</span>
            <h1>
              منصة وتطبيق عربي يحوّل <mark>ملفك الدراسي</mark> إلى مذاكرة جاهزة
            </h1>
            <p className={s.lede}>
              {SITE_NAME} وُلد عام {FOUNDED} من ملاحظة بسيطة: الطالب يملك المادة
              أصلًا — كتاب، ملزمة، أو ملف أسئلة سنوات سابقة — وما ينقصه هو الوقت
              لتحويلها إلى مذاكرة منظّمة. نحن نختصر هذه المسافة.
            </p>
          </div>
          <div className={s.figure} aria-hidden="true">
            <NiroCharacter expression="victory" size={200} animated={false} />
          </div>
        </header>

        <ul className={s.facts}>
          <li>
            <b>{FOUNDED}</b>
            <span>سنة التأسيس</span>
          </li>
          <li>
            <b>عربي أولًا</b>
            <span>الواجهة والشرح بالعربية، والمادة بلغتها الأصلية</span>
          </li>
          <li>
            <b>أينما تذاكر</b>
            <span>من المتصفح على الهاتف والحاسوب، ومن داخل Telegram</span>
          </li>
        </ul>

        <section className={s.block} aria-labelledby="story">
          <h2 id="story">لماذا {SITE_NAME}؟</h2>
          <div className={s.prose}>
            <p>
              قبل الامتحان يقضي الطالب ساعات في ما ليس مذاكرة: يلخّص، ينسخ
              الأسئلة، يرتّب ما سيراجعه. هذا عمل ضروري لكنه ليس التعلّم نفسه.
              فكرتنا أن ترفع الملف كما هو، فيُقسَّم إلى أجزاء وتُجهَّز لكل جزء
              أدوات مراجعته، لتبدأ من حيث يبدأ التعلّم فعلًا: أن تختبر نفسك
              وتعود إلى ما نسيت.
            </p>
            <p>
              بنينا المنصة للطالب العربي: الواجهة عربية من اليمين إلى اليسار،
              والشرح بالعربية حتى حين تكون المادة بالإنجليزية، مع بقاء المصطلح
              بلغته كما ستراه في الامتحان.
            </p>
          </div>
        </section>

        <section className={s.block} aria-labelledby="offer">
          <h2 id="offer">ماذا نقدّم؟</h2>
          <ul className={s.grid}>
            {OFFER.map(({ icon: Icon, title, text, href, link }) => (
              <li key={title} className={s.card}>
                <span className={s.icon}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
                <Link href={href}>{link}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.block} aria-labelledby="principles">
          <h2 id="principles">ما نلتزم به</h2>
          <ol className={s.principles}>
            <li className={s.principle}>
              <h3>ملفاتك لك</h3>
              <p>
                لا يظهر ملفك لطالب آخر إلا إذا شاركته أنت معه، وتستطيع حذف أي
                ملف أو حذف حسابك كله في أي وقت. كل ما نجمعه ولماذا مكتوب في{" "}
                <Link href="/privacy">سياسة الخصوصية</Link>.
              </p>
            </li>
            <li className={s.principle}>
              <h3>الذكاء الاصطناعي مساعد، والملف هو المرجع</h3>
              <p>
                ما يُولَّد من ملخصات وشروح مبنيّ على نص ملفك نفسه، وقد يخطئ.
                لذلك يبقى الملف الأصلي مرجعك دائمًا، ولا نقدّم المحتوى المولَّد
                بديلًا عن أستاذك أو كتابك.
              </p>
            </li>
            <li className={s.principle}>
              <h3>البداية مجانية</h3>
              <p>
                للمنصة باقة مجانية بحدود معلنة، وباقات مدفوعة بحدود أعلى وبلا
                إعلانات؛ تفاصيلها في <Link href="/pricing">صفحة الأسعار</Link>.
                الإعلانات التي قد تظهر على الباقة المجانية هي ما يبقيها متاحة.
              </p>
            </li>
          </ol>
        </section>

        <section className={s.block} aria-labelledby="team">
          <div className={s.team}>
            <h2 id="team">فريق {SITE_NAME}</h2>
            <p>
              يقف خلف المنصة فريقها نفسه: هو من يطوّرها، ويكتب محتواها
              واختباراتها، ويقرأ رسائلكم ويردّ عليها. إن وجدت خطأ في سؤال، أو
              لديك اقتراح أو ملاحظة، راسلنا على {email} أو من{" "}
              <Link href="/contact">صفحة التواصل</Link>.
            </p>
            <div className={s.actions}>
              <Link href="/register" className={s.buttonMain}>
                ابدأ مجانًا
              </Link>
              <Link href={QUIZZES_PATH} className={s.button}>
                جرّب اختبارًا الآن
              </Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingPage>
  );
}
