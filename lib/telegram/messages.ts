// ✈️ Everything the bot says, in one place. Plain text (the client sends no
// parse_mode), Arabic first, Niro's voice: short, warm, never a bare "Error".
import type { InlineButton, ReplyMarkup } from "./api";
import { miniAppEnabled, webUrl } from "./config";
import type { DocumentKind } from "./detect";
import type { SummaryStyle, SummaryTheme } from "../summary/types";

export const BUTTONS = {
  uploadQuestions: "📄 رفع أسئلة",
  uploadBook: "📚 رفع كتاب",
  summaryOnly: "📝 ملخّص PDF",
  myFiles: "📊 ملفاتي",
  howItWorks: "❓ كيف يعمل؟",
  openSite: "🌐 فتح NiroLearn",
  invite: "🎁 ادعُ زميلًا",
} as const;

// The keyboard under the message box. The command menu (/start, /files,
// /help) stays on Telegram's own "menu" button, so the way into the app is
// this keyboard's last button: with the Mini App on it opens NiroLearn
// inside Telegram; otherwise it sends its text and the bot answers with a
// link.
export function mainKeyboard(): ReplyMarkup {
  return {
    keyboard: [
      [{ text: BUTTONS.uploadQuestions }, { text: BUTTONS.uploadBook }],
      [{ text: BUTTONS.summaryOnly }],
      [{ text: BUTTONS.myFiles }, { text: BUTTONS.invite }],
      [
        { text: BUTTONS.howItWorks },
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

export function urlButton(text: string, url: string): {
  inline_keyboard: InlineButton[][];
} {
  return { inline_keyboard: [[{ text, url }]] };
}

function megabytes(bytes: number): string {
  return String(Math.floor(bytes / (1024 * 1024)));
}

export const TEXT = {
  welcome:
    "مرحبًا بك في NiroLearn 👋\n\n" +
    "ارفع ملف أسئلة أو كتاب بصيغة PDF وسنحوّله إلى تجربة دراسة تفاعلية.\n\n" +
    "اختر من الأزرار بالأسفل، أو أرسل الملف مباشرة.",

  howItWorks:
    "❓ كيف يعمل؟\n\n" +
    "1. أرسل ملف PDF هنا (ملف أسئلة أو كتاب).\n" +
    "2. نقرأ الملف ونجهّز المحتوى — تصلك رسالة عند الانتهاء.\n" +
    "3. اضغط الزر لتبدأ الدراسة في NiroLearn من المتصفح.\n\n" +
    "ملف الأسئلة يصير أسئلة تفاعلية مع الشرح بالعربية، والكتاب يُضاف إلى كتبك.",

  askForFile: (kind: DocumentKind) =>
    kind === "question_file"
      ? "📄 أرسل الآن ملف الأسئلة بصيغة PDF."
      : "📚 أرسل الآن الكتاب بصيغة PDF.",

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
    "📝 أرسل الآن الملف بصيغة PDF.\n\n" +
    "نكتب له ملخّصًا فقط ونرسله لك ملف PDF — بدون تجهيز أسئلة أو أدوات أخرى.",
  // A scanned file has no text to summarise without the book reader's OCR.
  summaryNoText:
    "⚠️ هذا الملف مصوَّر ولا نص فيه يمكن تلخيصه مباشرة.\n\n" +
    "أرسله بعد اختيار «رفع كتاب» ليُقرأ أولًا، ثم اطلب الملخّص من تحته.",
  summaryAskStyle: "📝 أي ملخّص تريد؟",
  summaryAskTheme: "🎨 اختر شكل الملخّص:",
  summaryStarted: (pages: number) =>
    `✍️ بدأنا كتابة ملخّصك (${pages} صفحة). يصلك ملف PDF هنا عند الانتهاء.`,
  summaryProgress: (done: number, total: number) =>
    `✍️ جاري كتابة الملخّص… ${done} من ${total} صفحة`,
  summaryReady: (title: string) =>
    `📝 ملخّصك جاهز\n\n«${title}»\n\nراجِعه مع مصدرك، وأرسله لزملائك 👇`,
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
  sharedQuestions: (title: string, owner: string | null) =>
    `📄 ${owner ?? "زميلك"} شارك معك ملف أسئلة\n\n«${title}»\n\nافتحه وابدأ الحل — تقدّمك خاص بك.`,
  sharedBook: (title: string, owner: string | null) =>
    `📖 ${owner ?? "زميلك"} شارك معك كتابًا\n\n«${title}»\n\nافتحه وادرس من ملخصاته وبطاقاته.`,
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

  received: "⏳ جاري استلام الملف…",
  reading: "🔍 جاري قراءة الملف…",
  finished: "☑ تم الانتهاء!",

  askKind:
    "🤔 لم أستطع تحديد نوع هذا الملف بثقة.\n\nكيف تريد أن أجهّزه؟",

  questionsReady: (count: number) =>
    "🎉 تم تجهيز ملف الأسئلة بنجاح\n\n" +
    `عدد الأسئلة: ${count}\n` +
    "يمكنك الآن بدء الدراسة من NiroLearn.",

  // Sent as soon as the questions are extracted, while their explanations
  // are still being written.
  questionsReadyPartial: (count: number) =>
    "🎉 أسئلتك جاهزة — ابدأ الآن\n\n" +
    `عدد الأسئلة: ${count}\n` +
    "🧠 الشرح والكلمات المفتاحية تُضاف الآن وتظهر تباعًا وأنت تحل.",

  noQuestions:
    "⚠️ قرأنا الملف لكن لم نعثر فيه على أسئلة اختيار من متعدد.\n\n" +
    "إن كان كتابًا أو ملخصًا أو ملاحظات، حوّله إلى كتاب بضغطة: تحصل منه على ملخص وفلاش كارد وأسئلة.",

  // The reader found mostly lines without options: notes, a summary, an
  // OSCE file (lib/question-file-quality.ts).
  looksLikeNotes: (answerable: number, pages: number) =>
    "🤔 هذا الملف يبدو شرحًا أو ملاحظات، وليس ملف أسئلة اختيار من متعدد.\n\n" +
    `وجدنا ${answerable} سؤالًا بخيارات فقط${pages > 0 ? ` في ${pages} صفحة` : ""}.\n\n` +
    "الأفضل تحويله إلى كتاب: تحصل منه على ملخص وفلاش كارد وأسئلة من محتواه.",
  convertStarted: "جاري تحويله إلى كتاب…",

  // Nothing is generated for a book until the student presses the button
  // on its page (booksRouter.startChapterAnalysis), so the message names
  // that step and the button as the page words it. Live, 2026-10-08: 10 of
  // 12 students who sent a book never pressed it.
  bookReady: (pages: number) =>
    "📚 وصل كتابك" +
    (pages > 0 ? ` (${pages} صفحة)` : "") +
    "\n\n" +
    "بقيت خطوة واحدة: افتح الكتاب واضغط «جهّز أدوات الدراسة»، فيُجهَّز لك الملخص والفلاش كارد والأسئلة والخريطة الذهنية.",

  stillWorking:
    "⏳ ما زال الملف قيد المعالجة — الملفات الكبيرة أو الممسوحة ضوئيًا تأخذ وقتًا أطول.\n\n" +
    "ستجده في «ملفاتي» عندما يجهز.",

  failed: (reason: string) =>
    "⚠️ لم نتمكن من معالجة الملف بالكامل.\n\n" + `السبب: ${reason}`,

  refused: (reason: string) => `⚠️ ${reason}`,

  downloadFailed:
    "⚠️ تعذّر استلام الملف من Telegram. أرسله مرة ثانية من فضلك.",

  retryStarted: "🔄 جاري إعادة المحاولة…",
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
} as const;

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
  studio: "🔷 تقرير عصري",
  bloom: "🌈 ألوان مرحة",
  dusk: "🌙 ليلي",
  paper: "📒 دفتر مذاكرة",
  classic: "📜 كلاسيكي",
};
// n / m / v: the buttons of the first set of looks, still in old chats.
const THEME_BY_LETTER: Record<string, SummaryTheme> = {
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
  const go = new RegExp(`^g:([ef])([sbdpcnmv]):(${UUID})$`, "i").exec(data);
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
