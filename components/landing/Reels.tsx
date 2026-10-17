// 🎬 The explainer reels: three or four scenes that play one after the
// other like a short video, with progress bars on top. They are markup,
// not video files: nothing to download, and their words are text a search
// engine or an AI answer can read. Server components; CSS does the motion
// (showcase.module.css), and under reduced motion the reel stands still on
// its most telling scene (`key`). Every scene is an illustration with
// example content, and says so in the caption.
import s from "./showcase.module.css";

type Scene = { label: string; body: React.ReactNode };

const MINUS_70 = "‎−70‎";

export function Reel({
  scenes,
  keyScene,
  label,
  caption = "مثال توضيحي بمحتوى تجريبي.",
  light = false,
}: {
  scenes: Scene[];
  /** The scene shown still when motion is reduced. */
  keyScene: number;
  /** What the whole reel shows, for a screen reader. */
  label: string;
  caption?: string;
  light?: boolean;
}) {
  const step = 4;
  return (
    <figure
      className={`${s.reel} ${scenes.length === 4 ? s.reel4 : ""}`}
      aria-label={label}
      data-reel=""
    >
      <div className={`${s.reelFrame} ${light ? s.reelLight : ""}`}>
        <div className={s.reelBars} aria-hidden="true">
          {scenes.map((scene, index) => (
            <span key={scene.label}>
              <i style={{ animationDelay: `${index * step}s` }} />
            </span>
          ))}
        </div>
        <div className={s.reelStage}>
          {scenes.map((scene, index) => (
            <div
              key={scene.label}
              className={`${s.scene} ${index === keyScene ? s.sceneKey : ""}`}
              style={{ animationDelay: `${index * step}s` }}
              // Only the scene in view is read; the rest are the same
              // story's other moments.
              aria-hidden={index === keyScene ? undefined : true}
            >
              <span className={s.sceneLabel}>{scene.label}</span>
              <div className={s.sceneBody}>{scene.body}</div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className={s.reelCaption}>{caption}</figcaption>
    </figure>
  );
}

// ── Scenes shared by several reels ────────────────────────────────────
function Upload({ name, note }: { name: string; note: string }) {
  return (
    <div className={s.center}>
      <div className={s.dropZone}>
        <span className={`${s.pdf} ${s.drop}`} />
        <b dir="auto">{name}</b>
        <span className={s.track}>
          <i className={s.load} />
        </span>
        <span className={s.muted}>{note}</span>
      </div>
    </div>
  );
}

function NeuronPage({ marked = true }: { marked?: boolean }) {
  return (
    <div className={s.paper} style={{ position: "relative", height: "100%" }}>
      <b>الخلية العصبية · صفحة 12</b>
      {marked ? (
        <span
          className={`${s.markLine} ${s.sweep}`}
          style={{ top: 50, insetInlineStart: 18, width: "84%" }}
        />
      ) : null}
      <span style={{ position: "relative" }}>
        تنقل الخلايا العصبية الإشارات على طول المحور بعيدًا عن جسم الخلية. ويبلغ
        جهد الراحة نحو {MINUS_70} ملي فولت، وتحافظ عليه مضخة الصوديوم
        والبوتاسيوم التي تنقل الأيونات عكس تدرّج تركيزها.
      </span>
    </div>
  );
}

function Pen() {
  return (
    <svg
      viewBox="0 0 300 120"
      aria-hidden="true"
      style={{
        position: "absolute",
        insetInlineStart: 30,
        top: 104,
        width: "60%",
        overflow: "visible",
      }}
    >
      <path
        className={s.pen}
        d="M140 20 C 190 4, 262 10, 268 34 C 274 58, 200 66, 150 60 C 112 55, 106 30, 140 20"
        fill="none"
        stroke="#dc3f46"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Room() {
  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <NeuronPage />
        <Pen />
        <span
          className={s.nameTag}
          style={{ background: "#dc3f46", insetInlineStart: 80, top: 196 }}
        >
          يوسف
        </span>
      </div>
      <div className={s.roomSide}>
        <div className={s.people}>
          <span>
            <i
              className={`${s.face} ${s.speak}`}
              style={{ background: "#3355ff" }}
            >
              م
            </i>
            منى
          </span>
          <span>
            <i className={s.face} style={{ background: "#c25f00" }}>
              س
            </i>
            سارة
          </span>
          <span>
            <i className={s.face} style={{ background: "#c2353b" }}>
              ي
            </i>
            يوسف
          </span>
          <span>
            <i className={s.face} style={{ background: "#0b7d57" }}>
              ن
            </i>
            نور
          </span>
        </div>
        <p className={`${s.bubble} ${s.pop}`} style={{ margin: 0 }}>
          <b>يوسف</b>
          <br />
          هذي تجي بالامتحان <span className={s.chip}>صفحة 12</span>
        </p>
      </div>
    </div>
  );
}

function Game() {
  return (
    <div
      className={s.card}
      style={{ display: "grid", gap: 10, height: "100%" }}
    >
      <span
        className={s.muted}
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>عواصم العالم العربي · سؤال 4 من 10</span>
        <span>4 لاعبين</span>
      </span>
      <span className={s.track} style={{ width: "100%", height: 6 }}>
        <i className={s.timer} />
      </span>
      <b style={{ fontSize: 20 }}>ما عاصمة سلطنة عُمان؟</b>
      <span className={s.grid2} style={{ height: "auto", fontSize: 15 }}>
        <span className={`${s.option} ${s.pick}`}>مسقط</span>
        <span className={s.option}>صلالة</span>
        <span className={s.option}>نزوى</span>
        <span className={s.option}>صحار</span>
      </span>
      <span className={`${s.muted} ${s.pop}`}>
        3 من 4 أجابوا · الأصحّ والأسرع يجمع نقاطًا أكثر
      </span>
    </div>
  );
}

// ── The reels ─────────────────────────────────────────────────────────
// The home page: from the file to the game.
export function HomeReel() {
  return (
    <Reel
      keyScene={2}
      label="عرض متحرك: رفع ملف PDF، ثم أدوات المذاكرة منه، ثم غرفة مذاكرة يكتب فيها الأصدقاء على الصفحة، ثم لعبة أسئلة جماعية"
      caption="من الملف إلى اللعبة في أربعة مشاهد. أمثلة توضيحية بمحتوى تجريبي."
      scenes={[
        {
          label: "1 · ارفع ملفك",
          body: (
            <Upload
              name="محاضرة 3 · الخلية العصبية.pdf"
              note="Niro يقرأ كل الصفحات، حتى المصوّرة منها"
            />
          ),
        },
        {
          label: "2 · ذاكر بالأدوات",
          body: (
            <div className={s.grid2}>
              <p className={`${s.card} ${s.fan}`} style={{ margin: 0 }}>
                <span className={s.tagline}>ملخص</span>
                المحور ينقل الإشارة بعيدًا عن جسم الخلية، وجهد الراحة نحو{" "}
                {MINUS_70} ملي فولت.
              </p>
              <p
                className={`${s.card} ${s.cardInk} ${s.fan} ${s.d1}`}
                style={{ margin: 0 }}
              >
                <small>Exam Focus · فخ امتحان · صفحة 12</small>
                <br />
                المضخة تُخرج 3 صوديوم وتُدخل 2 بوتاسيوم، لا العكس.
              </p>
              <p
                className={`${s.card} ${s.cardSoft} ${s.fan} ${s.d2}`}
                style={{ margin: 0 }}
              >
                <span className={s.tagline}>فلاش كارد</span>
                كم جهد الراحة للخلية العصبية؟
              </p>
              <p className={`${s.card} ${s.fan} ${s.d3}`} style={{ margin: 0 }}>
                <span className={s.tagline}>اختبار</span>
                ماذا ينقل المحور العصبي؟
                <span
                  className={`${s.option} ${s.pick}`}
                  style={{ marginTop: 6 }}
                >
                  الإشارة بعيدًا عن جسم الخلية
                </span>
              </p>
            </div>
          ),
        },
        { label: "3 · ذاكروا معًا في غرفة مجانية", body: <Room /> },
        { label: "4 · اختموا بلعبة", body: <Game /> },
      ]}
    />
  );
}

export function SummaryReel() {
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: رفع ملف PDF، ثم ملخص منظم لكل جزء، ثم شرح عربي مساند وأهم المصطلحات"
      scenes={[
        {
          label: "1 · ارفع الكتاب أو المحاضرة",
          body: (
            <Upload
              name="Neuroscience_Lecture3.pdf"
              note="بالعربية أو بالإنجليزية، حتى الصفحات المصوّرة"
            />
          ),
        },
        {
          label: "2 · ملخص منظم لكل جزء",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                display: "grid",
                gap: 8,
                alignContent: "start",
                background: "var(--nl-paper)",
              }}
            >
              <b className={s.fan}>1. الخلية العصبية</b>
              <span className={`${s.fan} ${s.d1}`}>
                • المحور ينقل الإشارة بعيدًا عن جسم الخلية.
              </span>
              <span className={`${s.fan} ${s.d2}`}>
                • جهد الراحة نحو {MINUS_70} ملي فولت.
              </span>
              <b className={`${s.fan} ${s.d2}`}>2. مضخة الصوديوم والبوتاسيوم</b>
              <span className={`${s.fan} ${s.d3}`}>
                • تنقل الأيونات عكس تدرّج تركيزها وتستهلك الطاقة.
              </span>
            </div>
          ),
        },
        {
          label: "3 · شرح عربي ومصطلحات",
          body: (
            <div className={s.grid2}>
              <p
                className={`${s.card} ${s.fan}`}
                style={{ margin: 0, background: "var(--nl-paper)" }}
              >
                <span className={s.tagline}>شرح عربي مساند</span>
                جهد الراحة هو فرق الشحنة عبر غشاء الخلية وهي لا ترسل إشارة.
              </p>
              <p
                className={`${s.card} ${s.fan} ${s.d1}`}
                style={{
                  margin: 0,
                  background: "var(--nl-paper)",
                  direction: "ltr",
                  textAlign: "left",
                }}
              >
                <span
                  className={s.tagline}
                  style={{ direction: "rtl", textAlign: "right" }}
                >
                  أهم المصطلحات
                </span>
                Axon — المحور
                <br />
                Resting potential — جهد الراحة
                <br />
                Na⁺/K⁺ pump — مضخة الصوديوم والبوتاسيوم
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

export function FlashcardsReel() {
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: بطاقات تُصنع من صفحة الملف، ثم تُقلب بعد محاولة التذكّر، ثم تُجدول بالتكرار المتباعد"
      scenes={[
        {
          label: "1 · بطاقات من صفحات ملفك",
          body: (
            <div className={s.grid2}>
              <NeuronPage marked={false} />
              <div style={{ display: "grid", gap: 10, alignContent: "center" }}>
                <span className={`${s.card} ${s.cardSoft} ${s.fan}`}>
                  ماذا ينقل المحور العصبي؟
                </span>
                <span className={`${s.card} ${s.cardSoft} ${s.fan} ${s.d1}`}>
                  كم جهد الراحة؟
                </span>
                <span className={`${s.card} ${s.cardSoft} ${s.fan} ${s.d2}`}>
                  ماذا تفعل المضخة؟
                </span>
              </div>
            </div>
          ),
        },
        {
          label: "2 · تذكّر، ثم اقلب",
          body: (
            <div
              className={s.center}
              style={{ perspective: 900, alignContent: "center", gap: 16 }}
            >
              <div
                className={s.flip}
                style={{ position: "relative", width: 300, height: 170 }}
              >
                <span
                  className={`${s.card} ${s.cardSoft} ${s.center}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    fontSize: 17,
                    fontWeight: 600,
                  }}
                >
                  كم جهد الراحة للخلية العصبية؟
                </span>
                <span
                  className={`${s.card} ${s.cardInk} ${s.center}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    fontSize: 17,
                    fontWeight: 600,
                    transform: "rotateY(180deg)",
                  }}
                >
                  نحو {MINUS_70} ملي فولت
                </span>
              </div>
              <span style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span className={s.option}>نسيتها</span>
                <span className={s.option}>صعبة</span>
                <span className={`${s.option} ${s.pick}`}>أعرفها</span>
              </span>
            </div>
          ),
        },
        {
          label: "3 · تعود في موعدها",
          body: (
            <div
              style={{
                display: "grid",
                gap: 14,
                alignContent: "center",
                height: "100%",
                fontSize: 14,
              }}
            >
              {[
                ["نسيتها", "تعود قريبًا", "12%", "#c2353b"],
                ["صعبة", "بعد أيام قليلة", "38%", "#c25f00"],
                ["أعرفها", "بعد مدة أطول", "86%", "#0b7d57"],
              ].map(([name, when, width, color]) => (
                <span
                  key={name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 1fr",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <b>{name}</b>
                  <span>
                    <span
                      className={s.track}
                      style={{ width: "100%", display: "block", height: 12 }}
                    >
                      <i
                        className={s.grow}
                        style={{ width, background: color }}
                      />
                    </span>
                    <span className={s.muted}>{when}</span>
                  </span>
                </span>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}

export function MindMapReel() {
  const node = (text: string, cls = "") => (
    <span
      className={`${s.card} ${s.fan} ${cls}`}
      style={{ padding: "6px 12px", background: "var(--nl-paper)" }}
    >
      {text}
    </span>
  );
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: جزء من الملف يتحوّل إلى خريطة ذهنية بمفاهيمه وأهم نقاطه"
      scenes={[
        { label: "1 · جزء من ملفك", body: <NeuronPage marked={false} /> },
        {
          label: "2 · المفهوم في الوسط",
          body: (
            <div
              className={s.center}
              style={{
                gridTemplateColumns: "1fr auto 1fr",
                gap: 14,
                alignItems: "center",
              }}
            >
              <span style={{ display: "grid", gap: 10 }}>
                {node("المحور")}
                {node("جهد الراحة", s.d1)}
              </span>
              <span
                className={`${s.card} ${s.cardInk}`}
                style={{ fontWeight: 700, fontSize: 16 }}
              >
                الخلية العصبية
              </span>
              <span style={{ display: "grid", gap: 10 }}>
                {node("مضخة الصوديوم والبوتاسيوم", s.d2)}
                {node("جهد الفعل", s.d3)}
              </span>
            </div>
          ),
        },
        {
          label: "3 · مع أهم نقطة للامتحان",
          body: (
            <div className={s.center}>
              <p
                className={`${s.card} ${s.cardInk} ${s.fan}`}
                style={{ margin: 0, maxWidth: 360 }}
              >
                <small>للامتحان</small>
                <br />
                المضخة تُخرج 3 صوديوم وتُدخل 2 بوتاسيوم في كل دورة.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

export function MethodReel() {
  return (
    <Reel
      light
      keyScene={2}
      label="عرض متحرك لطريقة المذاكرة: الصورة الكاملة، ثم أهم ما في الامتحان، ثم اختبار النفس، ثم المراجعة المتباعدة"
      scenes={[
        {
          label: "1 · الصورة الكاملة",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                background: "var(--nl-paper)",
                display: "grid",
                gap: 8,
                alignContent: "start",
              }}
            >
              <b className={s.fan}>الخلية العصبية</b>
              <span className={`${s.fan} ${s.d1}`}>
                المحور · جهد الراحة · المضخة · جهد الفعل
              </span>
            </div>
          ),
        },
        {
          label: "2 · ما يهم في الامتحان",
          body: (
            <div className={s.center}>
              <p
                className={`${s.card} ${s.cardInk} ${s.fan}`}
                style={{ margin: 0, maxWidth: 380 }}
              >
                <small>Exam Focus · أرقام وحدود · صفحة 12</small>
                <br />
                جهد الراحة للخلية العصبية نحو {MINUS_70} ملي فولت.
              </p>
            </div>
          ),
        },
        { label: "3 · اختبر نفسك", body: <Game /> },
        {
          label: "4 · راجع على فترات",
          body: (
            <div className={s.center}>
              <span
                className={`${s.card} ${s.cardSoft} ${s.fan}`}
                style={{ fontSize: 16 }}
              >
                3 بطاقات تحتاج مراجعتها اليوم
              </span>
            </div>
          ),
        },
      ]}
    />
  );
}

function Chat({ steps }: { steps: React.ReactNode[] }) {
  return (
    <div className={s.phone}>
      <b>NiroLearn Bot</b>
      {steps}
    </div>
  );
}

export function BotReel() {
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: إرسال ملف PDF إلى بوت NiroLearn في تيليجرام، ثم تجهيز الأسئلة، ثم سؤال تفاعلي بشرح عربي"
      scenes={[
        {
          label: "1 · أرسل الملف في تيليجرام",
          body: (
            <Chat
              steps={[
                <span key="a" className={`${s.msgIn} ${s.fan}`}>
                  renal_pharma.pdf
                </span>,
                <span key="b" className={`${s.msgOut} ${s.fan} ${s.d2}`}>
                  وصل ملفك. نجهّز الأسئلة…
                </span>,
              ]}
            />
          ),
        },
        {
          label: "2 · افتح الأسئلة",
          body: (
            <Chat
              steps={[
                <span key="a" className={s.msgOut}>
                  جاهزة: أسئلة تفاعلية بشرح عربي.
                </span>,
                <span key="b" className={`${s.msgButton} ${s.pop}`}>
                  افتح الأسئلة
                </span>,
              ]}
            />
          ),
        },
        {
          label: "3 · أجب واقرأ الشرح",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                display: "grid",
                gap: 8,
                alignContent: "start",
                background: "var(--nl-paper)",
              }}
            >
              <b dir="ltr" style={{ textAlign: "left" }}>
                Which drug causes ototoxicity?
              </b>
              <span
                className={s.option}
                dir="ltr"
                style={{ textAlign: "left" }}
              >
                Spironolactone
              </span>
              <span
                className={`${s.option} ${s.pick}`}
                dir="ltr"
                style={{ textAlign: "left" }}
              >
                Furosemide
              </span>
              <span className={s.pop}>
                الشرح: Furosemide قد يؤثّر على الأذن الداخلية، خاصة بالجرعات
                العالية.
              </span>
            </div>
          ),
        },
      ]}
    />
  );
}

export function PastQuestionsReel() {
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: ملف أسئلة سنوات سابقة يصير اختبارًا تفاعليًا مع شرح لكل إجابة"
      scenes={[
        {
          label: "1 · ارفع ملف الأسئلة",
          body: (
            <Upload
              name="Final_2023_questions.pdf"
              note="نستخرج كل سؤال وخياراته"
            />
          ),
        },
        {
          label: "2 · اختبار تفاعلي",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                display: "grid",
                gap: 8,
                alignContent: "start",
                background: "var(--nl-paper)",
              }}
            >
              <span className={s.muted}>سؤال 12 من 80</span>
              <b>ما الذي يحافظ على جهد الراحة للخلية العصبية؟</b>
              <span className={s.option}>قنوات الكالسيوم</span>
              <span className={`${s.option} ${s.pick}`}>
                مضخة الصوديوم والبوتاسيوم
              </span>
            </div>
          ),
        },
        {
          label: "3 · شرح وتقدّم",
          body: (
            <div className={s.center}>
              <p
                className={`${s.card} ${s.fan}`}
                style={{
                  margin: 0,
                  maxWidth: 380,
                  background: "var(--nl-paper)",
                }}
              >
                <span className={s.tagline}>الشرح</span>
                تنقل المضخة الأيونات عكس تدرّج تركيزها، فتحافظ على فرق الشحنة.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

export function SolveReel() {
  return (
    <Reel
      light
      keyScene={1}
      label="عرض متحرك: سؤال من ملف PDF ثم إجابته الصحيحة مع شرح يرجع إلى المادة"
      scenes={[
        {
          label: "1 · أرسل ملف الأسئلة",
          body: (
            <Upload
              name="Pharmacology_MCQs.pdf"
              note="بالعربية أو بالإنجليزية"
            />
          ),
        },
        {
          label: "2 · الإجابة لكل سؤال",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                display: "grid",
                gap: 8,
                alignContent: "start",
                background: "var(--nl-paper)",
              }}
            >
              <b dir="ltr" style={{ textAlign: "left" }}>
                Q7. Loop diuretics act on…
              </b>
              <span
                className={`${s.option} ${s.pick}`}
                dir="ltr"
                style={{ textAlign: "left" }}
              >
                Thick ascending limb
              </span>
              <span className={s.pop}>
                الإجابة الصحيحة: الجزء الصاعد السميك من عروة هنلي.
              </span>
            </div>
          ),
        },
        {
          label: "3 · مع الشرح",
          body: (
            <div className={s.center}>
              <p
                className={`${s.card} ${s.fan}`}
                style={{
                  margin: 0,
                  maxWidth: 380,
                  background: "var(--nl-paper)",
                }}
              >
                <span className={s.tagline}>لماذا؟</span>
                هناك يعمل ناقل Na-K-2Cl الذي يثبّطه Furosemide.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

// The study rooms: invite, study the file together, watch together, play.
export function RoomsReel() {
  return (
    <Reel
      keyScene={1}
      label="عرض متحرك: فتح غرفة مذاكرة مجانية ودعوة الأصدقاء، ثم المذاكرة معًا على ملف مشترك بالأقلام والصوت، ثم مشاهدة يوتيوب معًا، ثم اختبار جماعي"
      caption="غرفة واحدة في أربعة مشاهد. أمثلة توضيحية بمحتوى تجريبي."
      scenes={[
        {
          label: "1 · افتح غرفة وادعُ أصحابك",
          body: (
            <div className={s.center}>
              <div className={s.dropZone} style={{ borderStyle: "solid" }}>
                <b style={{ fontSize: 18 }}>مذاكرة مع الشلّة</b>
                <span className={s.muted}>غرفة خاصة · مجانية</span>
                <span className={`${s.bubble} ${s.fan}`} dir="ltr">
                  nirolearn.com/rooms/…
                </span>
                <span className={`${s.chip} ${s.pop}`}>نُسخ الرابط</span>
              </div>
            </div>
          ),
        },
        { label: "2 · ذاكروا على ملف واحد", body: <Room /> },
        {
          label: "3 · شاهدوا يوتيوب معًا",
          body: (
            <div style={{ display: "grid", gap: 10, height: "100%" }}>
              <div className={s.screen}>
                <div style={{ display: "grid", justifyItems: "center" }}>
                  <span className={s.playButton}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="#fff"
                      aria-hidden="true"
                    >
                      <path d="M7 4v16l13-8Z" />
                    </svg>
                  </span>
                  <span className={s.screenTitle}>شرح جهد الفعل</span>
                </div>
                <div className={s.progress}>
                  <span>
                    <i />
                  </span>
                  متزامن للجميع
                </div>
              </div>
              <p className={`${s.bubble} ${s.pop}`} style={{ margin: 0 }}>
                <b>سارة</b> هنا الشرح أوضح{" "}
                <span className={s.chip} dir="ltr">
                  03:42
                </span>
              </p>
            </div>
          ),
        },
        { label: "4 · اختموا باختبار جماعي", body: <Game /> },
      ]}
    />
  );
}

// Playing a ready quiz with friends: choose, invite, play, the podium.
export function GamesReel() {
  return (
    <Reel
      keyScene={2}
      label="عرض متحرك: اختيار اختبار من استكشف، ثم مشاركة رابط الغرفة مع الأصدقاء، ثم سؤال واحد للجميع بعدّاد، ثم منصة الفائزين"
      caption="لعبة جماعية في أربعة مشاهد. أمثلة توضيحية."
      scenes={[
        {
          label: "1 · اختر اختبارًا",
          body: (
            <div className={s.grid2}>
              {[
                ["عواصم العالم العربي", "10 أسئلة", "#14532d"],
                ["الحاسوب والتكنولوجيا", "20 سؤالًا", "#1e3a5f"],
                ["الصحة والإسعافات الأولية", "20 سؤالًا", "#7a1f2a"],
                ["اختراعات غيّرت حياتنا", "8 أسئلة", "#5a4a12"],
              ].map(([title, count, color], index) => (
                <span
                  key={title}
                  className={`${s.card} ${s.fan} ${["", s.d1, s.d2, s.d3][index]}`}
                  style={{ display: "grid", gap: 6, alignContent: "start" }}
                >
                  <span
                    style={{ height: 54, borderRadius: 10, background: color }}
                  />
                  <b style={{ fontSize: 14 }}>{title}</b>
                  <span className={s.muted} style={{ fontSize: 12 }}>
                    {count}
                  </span>
                </span>
              ))}
            </div>
          ),
        },
        {
          label: "2 · ادعُ أصدقاءك",
          body: (
            <div className={s.center}>
              <div className={s.dropZone} style={{ borderStyle: "solid" }}>
                <b style={{ fontSize: 18 }}>عواصم العالم العربي</b>
                <span className={`${s.bubble} ${s.fan}`} dir="ltr">
                  nirolearn.com/rooms/…
                </span>
                <span
                  className={s.people}
                  style={{
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    width: "100%",
                  }}
                >
                  {[
                    ["م", "#3355ff"],
                    ["س", "#c25f00"],
                    ["ي", "#c2353b"],
                    ["ن", "#0b7d57"],
                  ].map(([letter, color], index) => (
                    <i
                      key={letter}
                      className={`${s.face} ${s.pop}`}
                      style={{
                        background: color,
                        animationDelay: `${index * 0.2}s`,
                      }}
                    >
                      {letter}
                    </i>
                  ))}
                </span>
              </div>
            </div>
          ),
        },
        { label: "3 · سؤال واحد للجميع", body: <Game /> },
        {
          label: "4 · منصة الفائزين",
          body: (
            <div
              className={s.card}
              style={{
                height: "100%",
                display: "grid",
                alignContent: "end",
                justifyItems: "center",
              }}
            >
              <span
                style={{ display: "flex", alignItems: "flex-end", gap: 12 }}
              >
                {[
                  ["سارة", 110, "var(--nl-niro-soft)", "2"],
                  ["منى", 160, "var(--nl-marker)", "1"],
                  ["يوسف", 80, "var(--nl-paper)", "3"],
                ].map(([name, height, color, place]) => (
                  <span
                    key={name as string}
                    style={{
                      display: "grid",
                      justifyItems: "center",
                      gap: 6,
                      width: 86,
                    }}
                  >
                    <b>{name}</b>
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "100%",
                        height: height as number,
                        borderRadius: "12px 12px 0 0",
                        background: color as string,
                        fontSize: 26,
                        fontWeight: 700,
                      }}
                    >
                      {place}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          ),
        },
      ]}
    />
  );
}
