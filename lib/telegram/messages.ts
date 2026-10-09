// ✈️ Everything the bot says, in one place. Plain text (the client sends no
// parse_mode), Arabic first, Niro's voice: short, warm, never a bare "Error".
import type { InlineButton, ReplyMarkup } from "./api";
import { miniAppEnabled, webUrl } from "./config";
import type { DocumentKind } from "./detect";
import type { SummaryStyle, SummaryTheme } from "../summary/types";

// Named after what the student gets, not after what they send.
export const BUTTONS = {
  uploadQuestions: "🎯 اختبار من ملف أسئلة",
  uploadBook: "📚 بطاقات من كتاب",
  summaryOnly: "📝 ملخّص PDF",
  myFiles: "📊 ملفاتي",
  openSite: "🌐 NiroLearn",
  invite: "🎁 ادعُ زميلًا",
} as const;

export type ButtonKey = keyof typeof BUTTONS | "howItWorks";

// A keyboard stays in a chat until the bot sends the next one, so the
// labels of the first keyboard (2026-10-08) are still pressed.
const OLD_BUTTONS: Record<string, ButtonKey> = {
  "📄 رفع أسئلة": "uploadQuestions",
  "📚 رفع كتاب": "uploadBook",
  "🌐 فتح NiroLearn": "openSite",
  "❓ كيف يعمل؟": "howItWorks",
};

// Which keyboard button a message's text is, if any.
export function pressedButton(text: string): ButtonKey | null {
  const current = (Object.keys(BUTTONS) as (keyof typeof BUTTONS)[]).find(
    key => BUTTONS[key] === text
  );
  return current ?? OLD_BUTTONS[text] ?? null;
}

// The keyboard under the message box: the main service first and full
// width, the two other ways in, then the three small ones. "How it works"
// is the /help command of Telegram's own "menu" button. The last button is
// the way into the app: with the Mini App on it opens NiroLearn inside
// Telegram; otherwise it sends its text and the bot answers with a link.
export function mainKeyboard(): ReplyMarkup {
  return {
    keyboard: [
      [{ text: BUTTONS.uploadQuestions, style: "primary" }],
      [{ text: BUTTONS.summaryOnly }, { text: BUTTONS.uploadBook }],
      [
        { text: BUTTONS.myFiles },
        { text: BUTTONS.invite },
        miniAppEnabled()
          ? {
              text: BUTTONS.openSite,
              web_app: { url: webUrl("/tg?to=%2Fsubjects") },
            }
          : { text: BUTTONS.openSite },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

// The button the student is meant to press: one per message.
export const primary = <T extends InlineButton>(button: T): T => ({
  ...button,
  style: "primary",
});

export function urlButton(text: string, url: string): {
  inline_keyboard: InlineButton[][];
} {
  return { inline_keyboard: [[{ text, url }]] };
}

function megabytes(bytes: number): string {
  return String(Math.floor(bytes / (1024 * 1024)));
}

// A file's name as a message shows it: without ".pdf", and short.
export function shortFileName(name: string, max = 40): string {
  const clean = name
    .replace(/\.pdf$/i, "")
    .replace(/[_\s]+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

const RULE = "━━━━━━━━━━━━";

// The steps of one file, in the single message that follows it from
// "received" to its result: done, the one running now, still to come.
function steps(labels: string[], current: number): string {
  return labels
    .map(
      (label, i) =>
        `${i < current ? "✅" : i === current ? "⏳" : "▫️"} ${label}${i === current ? "…" : ""}`
    )
    .join("\n");
}

function progressBar(done: number, total: number): string {
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const filled = Math.round(share * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${Math.round(share * 100)}%`;
}

function minutes(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} ث` : `${Math.round(seconds / 60)} د`;
}

const UPLOAD_STEPS = ["استلام الملف", "قراءة الصفحات", "تجهيز النتيجة"];

export const TEXT = {
  welcome:
    "👋 أهلًا بك في NiroLearn\n\n" +
    "أرسل لي ملف PDF وأحوّله لشيء تذاكر منه:\n\n" +
    "🎯 ملف أسئلة ← اختبار تفاعلي مع شرح بالعربي\n" +
    "📝 أي ملف ← ملخّص PDF مرتّب\n" +
    "📚 كتاب أو محاضرة ← بطاقات وأسئلة وخريطة ذهنية\n\n" +
    "👇 اختر من الأزرار، أو أرسل ملفك مباشرة.",

  howItWorks:
    "❓ كيف يعمل؟\n" +
    `${RULE}\n` +
    "1️⃣ اختر ما تريده من الأزرار بالأسفل.\n" +
    "2️⃣ أرسل الملف بصيغة PDF.\n" +
    "3️⃣ نجهّزه وتصلك النتيجة هنا.\n\n" +
    `${BUTTONS.uploadQuestions}\n` +
    "لملف فيه أسئلة جاهزة ← اختبار تفاعلي مع شرح بالعربي.\n\n" +
    `${BUTTONS.summaryOnly}\n` +
    "لأي ملف ← ملف PDF فيه ملخّص مرتّب.\n\n" +
    `${BUTTONS.uploadBook}\n` +
    "لكتاب أو محاضرة ← بطاقات، أسئلة وخريطة ذهنية.\n\n" +
    "الأوامر: /files ملفاتك · /summary ملخّص · /invite دعوة زميل",

  // The one message that follows a file: 0 receiving, 1 reading, 2 result.
  uploadProgress: (fileName: string, step: 0 | 1 | 2) =>
    `📄 ${shortFileName(fileName)}\n${RULE}\n${steps(UPLOAD_STEPS, step)}`,
  kindChosen: (kind: DocumentKind) =>
    `✅ ${kind === "question_file" ? "ملف أسئلة" : "كتاب"}\n\n⏳ جاري تجهيزه…`,
  converting: "📚 جاري تحويله إلى كتاب…",
  retrying: "🔄 جاري إعادة المحاولة…",

  // Each of the three ways in says what to send and what comes back, so a
  // student never sends a lecture as a question file (or the other way).
  askForFile: (kind: DocumentKind) =>
    kind === "question_file"
      ? "📄 ملف أسئلة\n" +
        "━━━━━━━━━━━━\n" +
        "أرسل الآن ملف PDF فيه أسئلة جاهزة:\n" +
        "بنك أسئلة، امتحان سابق، أسئلة MCQ.\n\n" +
        "🎯 ماذا تحصل عليه؟\n" +
        "✅ اختبار تفاعلي تحل منه مباشرة\n" +
        "✅ شرح بالعربي لكل سؤال\n" +
        "✅ «اربطها» لتثبيت الإجابة في ذهنك\n\n" +
        "⚠️ يجب أن يحتوي الملف على أسئلة.\n" +
        "ملفك شرح أو محاضرة؟ اختر «" +
        BUTTONS.uploadBook +
        "»."
      : "📚 كتاب أو محاضرة\n" +
        "━━━━━━━━━━━━\n" +
        "أرسل الآن ملف PDF فيه شرح:\n" +
        "كتاب، محاضرة، ملزمة أو سلايدات.\n\n" +
        "🎯 ماذا تحصل عليه؟\n" +
        "🃏 بطاقات مراجعة\n" +
        "❓ أسئلة اختبار من محتوى الملف\n" +
        "🧠 خريطة ذهنية لكل فصل\n\n" +
        "💡 ملفك أسئلة جاهزة؟ اختر «" +
        BUTTONS.uploadQuestions +
        "».",

  notPdf: "⚠️ نقبل ملفات PDF فقط. أرسل الملف بصيغة PDF وجرّب مرة ثانية.",

  unknownMessage:
    "أرسل ملف PDF (أسئلة أو كتاب) وسأجهّزه لك، أو اختر من الأزرار بالأسفل.",

  suspended: "⚠️ هذا الحساب موقوف حاليًا. تواصل مع الدعم من موقع NiroLearn.",

  tooLarge: (limitBytes: number) =>
    `⚠️ حجم الملف أكبر من الحد المسموح هنا (${megabytes(limitBytes)} ميغابايت).\n\n` +
    "يمكنك رفعه من موقع NiroLearn مباشرة.",

  tooManyPages: (pages: number, limit: number) =>
    `⚠️ هذا الملف ${pages} صفحة، والحد هنا ${limit} صفحة للملف الواحد.\n\n` +
    "قسّمه إلى أجزاء أصغر وأرسل كل جزء وحده.",

  // 📝 Summaries (lib/summary).
  summaryNeedsAccount:
    "📝 الملخّصات للحسابات المسجّلة.\n\n" +
    "أنشئ حسابك المجاني أو سجّل الدخول، وملفاتك هنا تنتقل إليه كما هي.",
  summaryAskFile:
    "📝 ملخّص PDF\n" +
    "━━━━━━━━━━━━\n" +
    "أرسل الآن أي ملف PDF:\n" +
    "أسئلة، محاضرة أو كتاب.\n\n" +
    "🎯 ماذا تحصل عليه؟\n" +
    "📄 ملف PDF واحد: ملخّص مرتّب لملفك\n" +
    "🎨 بالشكل الذي تختاره\n\n" +
    "💡 هذا ملخّص فقط، بلا اختبار ولا بطاقات.\n" +
    "تريدها؟ اختر «" +
    BUTTONS.uploadQuestions +
    "» أو «" +
    BUTTONS.uploadBook +
    "».",
  // A scanned file has no text to summarise without the book reader's OCR.
  summaryNoText:
    "⚠️ هذا الملف مصوَّر ولا نص فيه يمكن تلخيصه مباشرة.\n\n" +
    `أرسله بعد اختيار «${BUTTONS.uploadBook}» ليُقرأ أولًا، ثم اطلب الملخّص من تحته.`,
  summaryAskStyle: "📝 أي ملخّص تريد؟",
  // The same message, after the first choice: it shows what was chosen.
  summaryAskTheme: (style: SummaryStyle) =>
    `اخترت: ${summaryStyleName(style)}\n\n🎨 اختر شكل الملخّص:`,
  // The one message that follows a summary from the last choice to the PDF.
  summaryProgress: (choice: SummaryChoice, done: number, total: number) =>
    `${summaryHeader(choice)}\n` +
    `✍️ جاري كتابة الملخّص… ${done} من ${total} صفحة\n` +
    `${progressBar(done, total)}\n\n` +
    "يصلك ملف PDF هنا عند الانتهاء.",
  summaryPrinting: (choice: SummaryChoice) =>
    `${summaryHeader(choice)}\n` +
    steps(["كتابة الصفحات", "ترتيب الفصول وتجهيز ملف PDF"], 1),
  summaryReady: (
    title: string,
    made?: { pages: number; sections: number; ms: number }
  ) =>
    `📝 ملخّصك جاهز\n\n«${title}»` +
    (made
      ? `\n\n📑 ${made.pages} صفحة من المصدر · 🧩 ${made.sections} أقسام · ⏱ ${minutes(made.ms)}`
      : "") +
    "\n\nراجِعه مع مصدرك، وأرسله لزملائك 👇",
  summaryShare:
    "📝 اعمل ملخّص PDF مرتّب من أي ملف أسئلة أو محاضرة — جرّب بوت NiroLearn 👇",
  summaryFailed:
    "⚠️ تعذّر تجهيز الملخّص هذه المرة، ولم يُحسب من رصيدك اليومي. جرّب بعد قليل.",
  summaryNotReady: "⏳ انتظر حتى تنتهي قراءة الملف ثم اطلب الملخّص.",
  summaryEmpty: "⚠️ لم نجد في هذا الملف نصًا نلخّصه.",
  summaryInProgress: "✍️ ملخّص هذا الملف قيد الكتابة — يصلك هنا عند الانتهاء.",
  summaryTooLong: (pages: number, limit: number, paid: boolean) =>
    `⚠️ هذا الملف ${pages} صفحة، والحد للملخّص ${limit} صفحة` +
    (paid ? "." : " في الباقة المجانية.\n\nللملفات الأطول رقِّ باقتك إلى Pro."),
  summaryDailyLimit: (limit: number, paid: boolean) =>
    (limit === 1
      ? "⚠️ استخدمت ملخّص اليوم."
      : `⚠️ وصلت لحد الملخّصات اليومي (${limit}).`) +
    " يتجدد غدًا." +
    (paid ? "" : "\n\nلأكثر من ملخّص في اليوم رقِّ باقتك إلى Pro."),

  guestLimit:
    "🎓 جرّبت NiroLearn بملفك الأول.\n\n" +
    "لرفع ملف آخر:\n" +
    "• سجّل الدخول أو أنشئ حسابًا مجانيًا — ملفك وتقدّمك ينتقلان إليه كما هما.\n" +
    "• أو ادعُ زميلًا: كل زميل يرفع ملفه الأول يمنحك ملفًا إضافيًا 🎁",

  // 🔗 Sharing a file by link (lib/share-links.ts).
  fileShare:
    "📚 شاركت معك ملفًا على NiroLearn — افتحه وادرس منه مباشرة داخل Telegram 👇",
  shareLinkReady: (title: string, joined: number) =>
    "📤 رابط مشاركة الملف\n\n" +
    `«${title}»\n\n` +
    "أرسله لزملائك: يفتحون الملف نفسه ويدرسون منه، ولكلٍّ تقدّمه الخاص. يمكنك إيقاف الرابط من صفحة الملف في أي وقت.\n\n" +
    `👥 انضم حتى الآن: ${joined}`,
  shareUnavailable: "لا يمكن مشاركة هذا الملف الآن.",
  // The card a classmate's link opens: whose file, what it is, how many
  // study from it, and (for questions) how many there are.
  sharedFile: (file: {
    kind: DocumentKind;
    title: string;
    owner: string | null;
    studying: number;
    questions?: number;
  }) =>
    `${file.kind === "book" ? "📖 كتاب" : "🎯 ملف أسئلة"} من ${file.owner ?? "زميلك"}\n` +
    `${RULE}\n` +
    `«${shortFileName(file.title, 60)}»\n\n` +
    (file.questions ? `❓ ${file.questions} سؤالًا\n` : "") +
    (file.studying > 1 ? `👥 يدرس منه ${file.studying} من زملائك\n` : "") +
    (file.kind === "book"
      ? "\nادرس من ملخصاته وبطاقاته — تقدّمك خاص بك."
      : "\nابدأ الحل الآن — إجاباتك وتقدّمك خاصان بك."),
  // What the chat picker sends for a file or an invitation (inline mode).
  sharedFileCard: (title: string, kind: DocumentKind, studying: number) =>
    `${kind === "book" ? "📖" : "🎯"} «${shortFileName(title, 60)}»\n\n` +
    (kind === "book"
      ? "كتاب جاهز للمذاكرة على NiroLearn: ملخصات وبطاقات وأسئلة."
      : "ملف أسئلة جاهز كاختبار تفاعلي مع الشرح بالعربي على NiroLearn.") +
    (studying > 0 ? `\n👥 يدرس منه ${studying} من زملائنا` : "") +
    "\n\nافتحه وادرس منه مباشرة داخل Telegram 👇",
  sharedOwn: "هذا ملفك أنت 🙂 افتحه من هنا:",
  // To the owner, at a milestone (lib/share-links.ts isJoinMilestone).
  shareJoined: (title: string, joined: number) =>
    (joined === 1
      ? "🎉 أول زميل فتح ملفك المشارَك"
      : `🎉 ${joined} من زملائك يدرسون الآن من ملفك`) +
    `\n\n«${title}»\n\nأرسل الرابط لمجموعة الدفعة ليستفيد الجميع 👇`,
  sharedInvalid:
    "⚠️ رابط المشاركة غير صالح أو أوقفه صاحبه. اطلب من زميلك رابطًا جديدًا.",

  // 🎁 Invites (lib/telegram/growth.ts).
  invite: (stats: { joined: number; available: number }) =>
    "🎁 ادعُ زملاءك واربح ملفات إضافية\n\n" +
    "أرسل رابطك لزميل. عندما يرفع ملفه الأول تحصل أنت على ملف إضافي مجانًا — بلا حد يومي ولا اشتراك.\n\n" +
    `👥 انضم عبر رابطك: ${stats.joined}\n` +
    `📄 ملفات إضافية متاحة لك: ${stats.available}`,
  inviteShare:
    "📚 جرّب NiroLearn: أرسل ملف الأسئلة PDF للبوت ويحوّله لاختبار تفاعلي مع الشرح بالعربي — مجانًا 👇",
  inviteEarned: (available: number) =>
    "🎉 زميلك رفع ملفه الأول عبر رابطك!\n\n" +
    `ربحت ملفًا إضافيًا — المتاح لك الآن: ${available} 📄\n` +
    "أرسل ملفك التالي متى شئت.",
  bonusUsed: "🎁 استخدمنا ملفًا من رصيد دعواتك لهذا الملف.",

  guestConnectHint:
    "💡 لديك حساب في NiroLearn أو تريد إنشاء حساب؟ اربطه بهذه المحادثة لتُحفظ ملفاتك وترفع المزيد.",

  accountReady:
    "✅ تم إنشاء حسابك في NiroLearn وربطه بهذه المحادثة.\n\nأرسل ملفك التالي متى شئت.",

  slowDown:
    "⏳ أرسلت عدة ملفات خلال وقت قصير. انتظر بضع دقائق ثم جرّب مرة ثانية.",

  busy: "⏳ الخدمة مشغولة جدًا الآن. جرّب مرة ثانية لاحقًا.",

  duplicateProcessing: "⏳ هذا الملف قيد المعالجة بالفعل — ستصلك رسالة عند الانتهاء.",
  duplicateReady: "هذا الملف مجهّز عندك من قبل 👇",

  askKind:
    "🤔 لم أستطع تحديد نوع هذا الملف بثقة.\n\nكيف تريد أن أجهّزه؟",

  // `partial`: sent as soon as the questions are extracted, while their
  // explanations are still being written.
  questionsReady: (
    count: number,
    file?: { fileName: string; pages: number; partial?: boolean }
  ) =>
    "🎉 اختبارك جاهز\n\n" +
    (file ? `📄 ${shortFileName(file.fileName)}\n` : "") +
    `❓ ${count} سؤالًا` +
    (file && file.pages > 0 ? ` · 📑 ${file.pages} صفحة` : "") +
    (file?.partial
      ? "\n\n🧠 الشرح والكلمات المفتاحية تُضاف الآن وتظهر تباعًا وأنت تحل."
      : "\n\n🧠 مع شرح بالعربي لكل سؤال."),


  noQuestions:
    "⚠️ قرأنا الملف لكن لم نعثر فيه على أسئلة اختيار من متعدد.\n\n" +
    "إن كان كتابًا أو ملخصًا أو ملاحظات، حوّله إلى كتاب بضغطة: تحصل منه على ملخص وفلاش كارد وأسئلة.",

  // The reader found mostly lines without options: notes, a summary, an
  // OSCE file (lib/question-file-quality.ts).
  looksLikeNotes: (answerable: number, pages: number) =>
    "🤔 هذا الملف يبدو شرحًا أو ملاحظات، وليس ملف أسئلة اختيار من متعدد.\n\n" +
    `وجدنا ${answerable} سؤالًا بخيارات فقط${pages > 0 ? ` في ${pages} صفحة` : ""}.\n\n` +
    "الأفضل تحويله إلى كتاب: تحصل منه على ملخص وفلاش كارد وأسئلة من محتواه.",
  // Nothing is generated for a book until the student presses the button
  // on its page (booksRouter.startChapterAnalysis), so the message names
  // that step and the button as the page words it. Live, 2026-10-08: 10 of
  // 12 students who sent a book never pressed it.
  bookReady: (pages: number, fileName?: string) =>
    "📚 وصل كتابك\n\n" +
    (fileName ? `📄 ${shortFileName(fileName)}\n` : "") +
    (pages > 0 ? `📑 ${pages} صفحة\n` : "") +
    "\n" +
    "بقيت خطوة واحدة: افتح الكتاب واضغط «جهّز أدوات الدراسة»، فيُجهَّز لك الملخص والفلاش كارد والأسئلة والخريطة الذهنية.",


  stillWorking:
    "⏳ ما زال الملف قيد المعالجة — الملفات الكبيرة أو الممسوحة ضوئيًا تأخذ وقتًا أطول.\n\n" +
    "ستجده في «ملفاتي» عندما يجهز.",

  failed: (reason: string) =>
    "⚠️ لم نتمكن من معالجة الملف بالكامل.\n\n" + `السبب: ${reason}`,

  refused: (reason: string) => `⚠️ ${reason}`,

  downloadFailed:
    "⚠️ تعذّر استلام الملف من Telegram. أرسله مرة ثانية من فضلك.",

  retryUnavailable: "لا يمكن إعادة المحاولة لهذا الملف. أرسله مرة ثانية.",

  noFiles: "لا توجد ملفات بعد. أرسل ملف PDF لتبدأ.",
  filesHeader: "📊 ملفاتك الأخيرة:",

  openSite: "🌐 افتح NiroLearn وتابع دراستك:",

  linked:
    "✅ تم ربط Telegram بحسابك في NiroLearn.\n\n" +
    "ملفاتك المرفوعة من هنا صارت في حسابك، وكل ملف ترسله بعد الآن يُضاف إليه.",
  // Phone verification for sign-up (lib/telegram/phone-verify.ts).
  verifyAsk:
    "📱 طلب تحقق لإنشاء حساب في NiroLearn.\n\n" +
    "اضغط الزر بالأسفل لمشاركة رقمك، وسنتأكد أنه نفس الرقم الذي كتبته في صفحة التسجيل.\n\n" +
    "⚠️ إن لم تكن أنت من بدأ التسجيل الآن، لا تشارك رقمك.",
  verifyDone:
    "✅ تم التحقق من رقمك.\n\nارجع إلى صفحة التسجيل في المتصفح لإكمال حسابك.",
  verifyMismatch:
    "⚠️ الرقم الذي شاركته لا يطابق الرقم المكتوب في صفحة التسجيل.\n\nصحّح الرقم هناك وحاول مرة ثانية.",
  verifyNotOwn: "⚠️ شارك رقمك أنت من الزر، لا جهة اتصال أخرى.",
  verifyNoRequest:
    "لا يوجد طلب تحقق مفتوح الآن. ابدأ من صفحة إنشاء الحساب في NiroLearn.",
  verifyInvalid:
    "⚠️ رابط التحقق غير صالح أو انتهت صلاحيته. ابدأ من جديد من صفحة إنشاء الحساب.",

  linkInvalid:
    "⚠️ رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من صفحة حسابك في NiroLearn.",
  linkElsewhere: "⚠️ حساب Telegram هذا مربوط بحساب NiroLearn آخر.",
  linkAccountBusy: "⚠️ حسابك في NiroLearn مربوط بحساب Telegram آخر. افصله أولًا من صفحة حسابك.",
} as const;

export const LABELS = {
  startQuestions: "🚀 ابدأ الأسئلة",
  openBook: "📖 افتح الكتاب",
  openBookToStart: "📖 افتح الكتاب وابدأ",
  openSite: "🌐 فتح NiroLearn",
  uploadFromSite: "🌐 ارفعه من الموقع",
  connectAccount: "🔗 تسجيل الدخول / إنشاء حساب",
  retry: "🔄 إعادة المحاولة",
  asQuestions: "📄 ملف أسئلة",
  asBook: "📚 كتاب",
  convertToBook: "📚 حوّله إلى كتاب",
  openAnyway: "📄 افتح الأسئلة كما هي",
  shareContact: "📱 مشاركة رقمي",
  shareInvite: "📨 أرسل الدعوة لزملائك",
  inviteFriend: "🎁 ادعُ زميلًا واربح ملفًا",
  shareFile: "📤 شارك الملف مع زملائك",
  makeSummary: "📝 اعمل ملخّص PDF",
  summaryFull: "📚 ملخّص شامل",
  summaryExam: "⚡ مراجعة ليلة الامتحان",
  upgrade: "⭐ باقات NiroLearn",
  sendToFriends: "📨 أرسله لزملائك",
  tryBot: "🚀 جرّب NiroLearn",
} as const;

export type SummaryChoice = { style: SummaryStyle; theme: SummaryTheme };

const summaryStyleName = (style: SummaryStyle) =>
  style === "exam" ? LABELS.summaryExam : LABELS.summaryFull;

function summaryHeader(choice: SummaryChoice): string {
  return `${summaryStyleName(choice.style)} · ${SUMMARY_THEME_LABELS[choice.theme]}\n${RULE}`;
}

// callback_data is limited to 64 bytes: a short tag + the upload's uuid.
export const CALLBACK = {
  kind: (uploadId: string, kind: DocumentKind) =>
    `k:${kind === "question_file" ? "q" : "b"}:${uploadId}`,
  retry: (uploadId: string) => `r:${uploadId}`,
  share: (uploadId: string) => `s:${uploadId}`,
  convert: (uploadId: string) => `c:${uploadId}`,
  // 📝 A summary, in three presses: ask → the kind → the look.
  summary: (uploadId: string) => `m:${uploadId}`,
  summaryStyle: (uploadId: string, style: SummaryStyle) =>
    `y:${style === "exam" ? "e" : "f"}:${uploadId}`,
  summaryGo: (uploadId: string, style: SummaryStyle, theme: SummaryTheme) =>
    `g:${style === "exam" ? "e" : "f"}${theme[0]}:${uploadId}`,
};

export const SUMMARY_THEME_LABELS: Record<SummaryTheme, string> = {
  revision: "🩺 مراجعة سريعة (خريطة وجداول)",
  handout: "📄 مستند بسيط",
  studio: "🔷 تقرير عصري",
  bloom: "🌈 ألوان مرحة",
  dusk: "🌙 ليلي",
  paper: "📒 دفتر مذاكرة",
  classic: "📜 كلاسيكي",
};
// n / m / v: the buttons of the first set of looks, still in old chats.
const THEME_BY_LETTER: Record<string, SummaryTheme> = {
  r: "revision",
  h: "handout",
  s: "studio",
  b: "bloom",
  d: "dusk",
  p: "paper",
  c: "classic",
  n: "studio",
  m: "bloom",
  v: "dusk",
};

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseCallback(
  data: string
):
  | { action: "kind"; uploadId: string; kind: DocumentKind }
  | { action: "retry"; uploadId: string }
  | { action: "share"; uploadId: string }
  | { action: "convert"; uploadId: string }
  | { action: "summary"; uploadId: string }
  | { action: "summaryStyle"; uploadId: string; style: SummaryStyle }
  | {
      action: "summaryGo";
      uploadId: string;
      style: SummaryStyle;
      theme: SummaryTheme;
    }
  | null {
  const kind = new RegExp(`^k:([qb]):(${UUID})$`, "i").exec(data);
  if (kind) {
    return {
      action: "kind",
      uploadId: kind[2],
      kind: kind[1] === "q" ? "question_file" : "book",
    };
  }
  const retry = new RegExp(`^r:(${UUID})$`, "i").exec(data);
  if (retry) return { action: "retry", uploadId: retry[1] };
  const share = new RegExp(`^s:(${UUID})$`, "i").exec(data);
  if (share) return { action: "share", uploadId: share[1] };
  const convert = new RegExp(`^c:(${UUID})$`, "i").exec(data);
  if (convert) return { action: "convert", uploadId: convert[1] };
  const summary = new RegExp(`^m:(${UUID})$`, "i").exec(data);
  if (summary) return { action: "summary", uploadId: summary[1] };
  const style = new RegExp(`^y:([ef]):(${UUID})$`, "i").exec(data);
  if (style) {
    return {
      action: "summaryStyle",
      uploadId: style[2],
      style: style[1].toLowerCase() === "e" ? "exam" : "full",
    };
  }
  const go = new RegExp(`^g:([ef])([rhsbdpcnmv]):(${UUID})$`, "i").exec(data);
  if (go) {
    return {
      action: "summaryGo",
      uploadId: go[3],
      style: go[1].toLowerCase() === "e" ? "exam" : "full",
      theme: THEME_BY_LETTER[go[2].toLowerCase()],
    };
  }
  return null;
}

export function filePath(kind: DocumentKind, bookId: string): string {
  return kind === "question_file"
    ? `/books/question-files/${bookId}`
    : `/books/${bookId}`;
}
