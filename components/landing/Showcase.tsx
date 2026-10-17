// The sections about studying together — the free study rooms, watching a
// YouTube lesson together, Discover's ready quizzes and how friends play
// them — plus the question files and the Telegram bot, promoted from a
// line under "and also" to a section of their own. Shared by the home page
// and the new public pages (app/study-rooms, app/quiz-with-friends).
// Server components: the only client island is Discover's drawn cover.
import Link from "next/link";
import { Cover } from "@/components/discover/Cover";
import { label } from "@/lib/discover/i18n";
import {
  PUBLIC_QUIZZES,
  QUIZZES_PATH,
  publicQuiz,
  quizPath,
  quizzesIn,
  totalQuestions,
} from "@/lib/discover/public";
import {
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  QUIZ_FRIENDS_PATH,
  ROOMS_PAGE_PATH,
  SOLVE_QUESTIONS_PATH,
} from "@/lib/site";
import s from "./showcase.module.css";

// "3 أسئلة" / "20 سؤالًا": the Arabic count agrees with its noun.
export function questionsLabel(n: number): string {
  if (n === 1) return "سؤال واحد";
  if (n === 2) return "سؤالان";
  if (n >= 3 && n <= 10) return `${n} أسئلة`;
  return `${n} سؤالًا`;
}

// What Discover holds, read from the same files as its public pages.
export const DISCOVER_FACTS = {
  quizzes: PUBLIC_QUIZZES.length,
  questions: totalQuestions(PUBLIC_QUIZZES),
  categories: [...new Set(quizzesIn("ar").map(quiz => quiz.category))],
  channels: new Set(PUBLIC_QUIZZES.map(quiz => quiz.channelName)).size,
};

const SHOWN_QUIZZES = [
  "ar-geo-arab-capitals",
  "ar-tech-computers",
  "ar-health-first-aid",
  "ar-general-inventions",
];

export function RoomsSection({
  headingLevel = "h2",
  withLink = true,
}: {
  headingLevel?: "h1" | "h2";
  withLink?: boolean;
}) {
  const Heading = headingLevel;
  return (
    <section
      id="rooms"
      className={`${s.band} ${s.night}`}
      aria-labelledby="rooms-title"
    >
      <div className={s.wrap}>
        <p className={s.new}>جديد في NiroLearn</p>
        <Heading id="rooms-title" className={s.h2}>
          غرف المذاكرة الجماعية، مجانًا
        </Heading>
        <p className={s.lede}>
          غرفة مذاكرة أونلاين فيها كل ما تحتاجه الشلّة: الصوت، والملف أمام
          الجميع، والأقلام، والمحادثة. ادخل من الجوال أو الكمبيوتر، وتبقى الغرفة
          معك وأنت تتنقّل في الموقع.
        </p>
        <div className={s.cards3}>
          <article className={s.nightCard}>
            <div className={`${s.art} ${s.eq}`} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <h3>صوت ورفع يد</h3>
            <p>
              تتكلّمون كأنكم على طاولة واحدة. القائد يسمح بالكلام، ومن عنده سؤال
              يرفع يده.
            </p>
          </article>
          <article className={s.nightCard}>
            <div className={`${s.art} ${s.miniPage}`} aria-hidden="true">
              <span className={s.sweep} />
            </div>
            <h3>ملف واحد أمام الجميع، وأقلام للكل</h3>
            <p>
              الصفحات تحت بعضها والجميع على نفس الصفحة. قلم وقلم تحديد وممحاة
              وتحديد بالحبل، وكل علامة باسم صاحبها.
            </p>
          </article>
          <article className={s.nightCard}>
            <div
              className={s.art}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
              aria-hidden="true"
            >
              <span className={s.bubble}>نرجع لهذي النقطة؟</span>
              <span className={s.chip}>صفحة 18</span>
            </div>
            <h3>محادثة تعرف الصفحة</h3>
            <p>كل رسالة تحمل صفحتها أو لحظة الفيديو، وبضغطة تذهب إليها.</p>
          </article>
        </div>
        {withLink ? (
          <Link href={ROOMS_PAGE_PATH} className={s.cta}>
            كل شيء عن غرف المذاكرة
          </Link>
        ) : (
          <Link href="/register" className={s.cta}>
            افتح غرفتك الأولى مجانًا
          </Link>
        )}
      </div>
    </section>
  );
}

export function WatchTogetherSection() {
  return (
    <section
      id="watch-together"
      className={`${s.band} ${s.night} ${s.nightTight}`}
      aria-labelledby="watch-title"
    >
      <div className={`${s.wrap} ${s.split}`}>
        <div>
          <h2 id="watch-title" className={s.h2}>
            شاهدوا شرح يوتيوب معًا، وتكلّموا وأنتم تشاهدون
          </h2>
          <p className={s.lede}>
            الصق رابط فيديو يوتيوب في الغرفة فيظهر للجميع في نفس اللحظة. يتوقّف
            حين يوقفه القائد ويكمل حين يكمل، والصوت مفتوح للنقاش أثناء المشاهدة.
          </p>
          <ul className={s.ticks}>
            <li>تشغيل وإيقاف وتقديم متزامن للجميع</li>
            <li>رسالة المحادثة تحمل لحظة الفيديو، وبضغطة ترجع لها</li>
            <li>بدّل بين الفيديو وملف المذاكرة في نفس الغرفة</li>
          </ul>
        </div>
        <figure
          className={s.player}
          style={{ margin: 0 }}
          aria-label="مثال: أصدقاء يشاهدون فيديو يوتيوب معًا في غرفة، مع محادثة تحمل لحظات الفيديو"
        >
          <div className={s.screen} aria-hidden="true">
            <div style={{ display: "grid", justifyItems: "center" }}>
              <span className={s.playButton}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                  <path d="M7 4v16l13-8Z" />
                </svg>
              </span>
              <span className={s.screenTitle}>شرح جهد الفعل في 10 دقائق</span>
            </div>
            <div className={s.progress}>
              <span>
                <i />
              </span>
              متزامن للجميع · 4 يشاهدون
            </div>
          </div>
          <div className={s.watchers}>
            <div aria-hidden="true">
              <i
                className={`${s.dot} ${s.speak}`}
                style={{ background: "#3355ff" }}
              />
              <i className={s.dot} style={{ background: "#c25f00" }} />
              <i className={s.dot} style={{ background: "#0b7d57" }} />
            </div>
            <div>
              <p className={s.bubble} style={{ margin: 0 }}>
                <b>سارة</b> هنا الشرح أوضح{" "}
                <span className={s.chip} dir="ltr">
                  03:42
                </span>
              </p>
              <p className={`${s.bubble} ${s.pop}`} style={{ margin: 0 }}>
                <b>منى</b> نوقف ونحلّ سؤالًا عليها؟
              </p>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}

export function DiscoverSection({ withLink = true }: { withLink?: boolean }) {
  const quizzes = SHOWN_QUIZZES.map(publicQuiz).filter(
    (quiz): quiz is NonNullable<typeof quiz> => quiz !== null
  );
  return (
    <section id="discover" className={s.band} aria-labelledby="discover-title">
      <div className={s.wrap}>
        <p className={s.new}>جديد في NiroLearn</p>
        <h2 id="discover-title" className={s.h2}>
          «استكشف»: مكتبة اختبارات جاهزة للّعب
        </h2>
        <p className={s.lede}>
          اختبارات ثقافة عامة ومعرفة مرتّبة في أقسام وقنوات، تلعبها وحدك لتتعلّم
          أو مع أصدقائك في غرفة. كل اختبار مفتوح للتجربة هنا دون تسجيل.
        </p>
        <dl className={s.stats}>
          <div>
            <dt>اختبارًا جاهزًا</dt>
            <dd>{DISCOVER_FACTS.quizzes}</dd>
          </div>
          <div>
            <dt>سؤالًا</dt>
            <dd>{DISCOVER_FACTS.questions}</dd>
          </div>
          <div>
            <dt>قسمًا</dt>
            <dd>{DISCOVER_FACTS.categories.length}</dd>
          </div>
          <div>
            <dt>قنوات بالعربية والإنجليزية</dt>
            <dd>{DISCOVER_FACTS.channels}</dd>
          </div>
        </dl>
        <ul className={s.chips} aria-label="أقسام استكشف">
          {DISCOVER_FACTS.categories.map(category => (
            <li key={category}>{label("ar", category)}</li>
          ))}
        </ul>
        <div className={s.quizzes}>
          {quizzes.map(quiz => (
            <Link
              key={quiz.slug}
              href={quizPath(quiz.slug)}
              className={s.quizCard}
            >
              <Cover
                art={quiz.art}
                color={quiz.color}
                className={s.quizCover}
              />
              <b>{quiz.title}</b>
              <small>
                {questionsLabel(quiz.questions.length)} · {quiz.channelName}
              </small>
            </Link>
          ))}
        </div>
        <p className={s.moreLink}>
          <Link href={QUIZZES_PATH}>تصفّح كل الاختبارات الجاهزة</Link>
        </p>

        <h3 className={s.h2} style={{ fontSize: 26, marginTop: 56 }}>
          ثلاث طرق لتلعب الاختبار نفسه
        </h3>
        <div className={s.cards3}>
          <article className={s.dayCard}>
            <h3>تعلّم: سؤالًا بسؤال</h3>
            <p>
              تعرف الجواب الصحيح فورًا، مع صوت وموسيقى إن أردت، وتحصل على نجوم
              حسب نتيجتك.
            </p>
          </article>
          <article className={s.dayCard}>
            <h3>البطاقات: اقلب واسحب</h3>
            <p>
              اسحب يمينًا إن عرفتها، ويسارًا لتراجعها لاحقًا، ثم أعد ما يحتاج
              مراجعة فقط.
            </p>
          </article>
          <article className={`${s.dayCard} ${s.dayCardInk}`}>
            <h3>العب مع الأصدقاء</h3>
            <p>
              نفس السؤال للجميع في نفس اللحظة، والنقاط للأصحّ والأسرع، وفي
              النهاية منصة الفائزين.
            </p>
          </article>
        </div>
        {withLink ? (
          <Link href={QUIZ_FRIENDS_PATH} className={`${s.cta} ${s.ctaInk}`}>
            كيف تلعب مع أصدقائك
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export function PlayStepsSection() {
  return (
    <section
      id="play-with-friends"
      className={`${s.band} ${s.bandWhite}`}
      aria-labelledby="play-title"
    >
      <div className={s.wrap}>
        <h2 id="play-title" className={s.h2}>
          كيف تلعب مع أصدقائك؟
        </h2>
        <ol className={s.steps}>
          <li>
            <div className={s.stepArt} aria-hidden="true">
              <span>
                عواصم العالم العربي
                <br />
                <b style={{ color: "var(--nl-niro-deep)" }}>العب مع الأصدقاء</b>
              </span>
            </div>
            <b>1</b>
            <h3>اختر اختبارًا</h3>
            <p>من «استكشف»، أو من الألعاب داخل غرفتك، أو من أسئلة ملفك.</p>
          </li>
          <li>
            <div className={s.stepArt} aria-hidden="true">
              <span dir="ltr">
                nirolearn.com/rooms/…
                <br />
                <b style={{ color: "var(--nl-correct)" }}>نُسخ الرابط</b>
              </span>
            </div>
            <b>2</b>
            <h3>ادعُ أصدقاءك</h3>
            <p>تُفتح غرفة خاصة مجانًا. شارك رابطها في واتساب أو تيليجرام.</p>
          </li>
          <li>
            <div className={s.stepArt} aria-hidden="true">
              <span
                style={{
                  background: "var(--nl-niro)",
                  color: "#fff",
                  fontWeight: 600,
                }}
              >
                ابدأ اللعب الآن
              </span>
            </div>
            <b>3</b>
            <h3>ابدأ حين يدخلون</h3>
            <p>نفس السؤال يظهر للجميع معًا، وعدّاد واحد للكل.</p>
          </li>
          <li>
            <div className={s.podium} aria-hidden="true">
              <i
                style={{
                  height: 54,
                  background: "var(--nl-niro-soft)",
                  animationDelay: ".2s",
                }}
              />
              <i style={{ height: 80, background: "var(--nl-marker)" }} />
              <i
                style={{
                  height: 40,
                  background: "var(--nl-rule)",
                  animationDelay: ".35s",
                }}
              />
            </div>
            <b>4</b>
            <h3>منصة الفائزين</h3>
            <p>النقاط للأصحّ والأسرع، والنتيجة تبقى في ملخص الجلسة.</p>
          </li>
        </ol>
      </div>
    </section>
  );
}

export function QuestionsSection() {
  return (
    <section
      id="question-files"
      className={`${s.band} ${s.bandWhite}`}
      aria-labelledby="questions-title"
    >
      <div className={s.wrap}>
        <h2 id="questions-title" className={s.h2}>
          ملفات أسئلة السنوات، وحلّها بالذكاء الاصطناعي
        </h2>
        <p className={s.lede}>
          ارفع ملف أسئلة سنوات سابقة فيصير اختبارًا تفاعليًا، أو اطلب حل أسئلة
          ملفك مع شرح كل إجابة.
        </p>
        <div className={s.cards2}>
          <Link
            href={PAST_QUESTIONS_PATH}
            className={s.dayCard}
            style={{
              textDecoration: "none",
              color: "inherit",
              background: "var(--nl-paper)",
            }}
          >
            <h3>حوّل أسئلة السنوات السابقة إلى اختبار</h3>
            <p>
              كل سؤال من ملفك يصير سؤالًا تفاعليًا مع شرح، تراجعه حتى تتقنه.
            </p>
            <b style={{ color: "var(--nl-niro-deep)" }}>
              صفحة أسئلة السنوات السابقة
            </b>
          </Link>
          <Link
            href={SOLVE_QUESTIONS_PATH}
            className={s.dayCard}
            style={{
              textDecoration: "none",
              color: "inherit",
              background: "var(--nl-paper)",
            }}
          >
            <h3>حل أسئلة ملف PDF بالذكاء الاصطناعي</h3>
            <p>الإجابة الصحيحة لكل سؤال، مع شرح يرجع إلى المادة.</p>
            <b style={{ color: "var(--nl-niro-deep)" }}>صفحة حل الأسئلة</b>
          </Link>
        </div>

        <div id="telegram" className={s.botBand}>
          <div>
            <h3>بوت تيليجرام: أرسل الملف، وذاكر من هاتفك</h3>
            <p>
              أرسل ملف PDF إلى <span dir="ltr">@Nirolearnbot</span> فيصلك اختبار
              تفاعلي بشرح عربي لكل إجابة، أو يُضاف الكتاب إلى مكتبتك، داخل
              تيليجرام أو في المتصفح.
            </p>
            <Link href={BOT_PAGE_PATH} className={`${s.cta} ${s.telegram}`}>
              كل شيء عن بوت تيليجرام
            </Link>
          </div>
          <div
            className={s.phone}
            aria-label="مثال لمحادثة مع بوت NiroLearn"
            role="img"
          >
            <b>NiroLearn Bot</b>
            <span className={`${s.msgIn} ${s.fan}`}>renal_pharma.pdf</span>
            <span className={`${s.msgOut} ${s.fan} ${s.d2}`}>
              وصل ملفك. نجهّز الأسئلة…
            </span>
            <span className={`${s.msgButton} ${s.fan} ${s.d3}`}>
              افتح الأسئلة
            </span>
          </div>
        </div>

        <div className={s.alsoGrid}>
          <div>
            <h3>قارئ PDF</h3>
            <p>تظليل وملاحظات على صفحات ملفك.</p>
          </div>
          <div>
            <h3>حزم مذاكرة مشتركة</h3>
            <p>شارك ملفك وأدواته مع زملائك.</p>
          </div>
          <div>
            <h3>ألعاب مراجعة مع Niro</h3>
            <p>جولات سريعة لتثبيت ما ذاكرته.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// Under every tool page: the same file, studied together.
export function TogetherBand() {
  return (
    <section aria-labelledby="together-title" style={{ padding: "8px 0 56px" }}>
      <div className={s.wrap}>
        <div className={s.together}>
          <div>
            <p className={s.new} style={{ color: "var(--nl-marker)" }}>
              جديد
            </p>
            <h2 id="together-title">ذاكروا الملف نفسه معًا، في غرفة مجانية</h2>
            <p>
              اعرض الملف لأصحابك واكتبوا عليه، شاهدوا شرح يوتيوب معًا، واختموا
              باختبار جماعي.
            </p>
          </div>
          <Link href={ROOMS_PAGE_PATH} className={s.cta}>
            عن غرف المذاكرة
          </Link>
        </div>
      </div>
    </section>
  );
}
