// ✈️ Everything the bot says, in one place. Plain text (the client sends no
// parse_mode), Arabic first, Niro's voice: short, warm, never a bare "Error".
import type { InlineButton, ReplyMarkup } from "./api";
import type { DocumentKind } from "./detect";

export const BUTTONS = {
  uploadQuestions: "📄 رفع أسئلة",
  uploadBook: "📚 رفع كتاب",
  myFiles: "📊 ملفاتي",
  howItWorks: "❓ كيف يعمل؟",
  openSite: "🌐 فتح NiroLearn",
} as const;

export const MAIN_KEYBOARD: ReplyMarkup = {
  keyboard: [
    [{ text: BUTTONS.uploadQuestions }, { text: BUTTONS.uploadBook }],
    [{ text: BUTTONS.myFiles }, { text: BUTTONS.howItWorks }],
    [{ text: BUTTONS.openSite }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

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

  guestLimit:
    "🎓 جرّبت NiroLearn بملفك الأول.\n\n" +
    "لرفع ملفات أخرى سجّل الدخول إلى حسابك أو أنشئ حسابًا مجانيًا — ملفك الحالي وتقدّمك ينتقلان إلى حسابك كما هما.",

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
  preparing: (done: number, total: number) =>
    total > 0
      ? `🧠 جاري تجهيز المحتوى… (${done} من ${total})`
      : "🧠 جاري تجهيز المحتوى…",
  finished: "☑ تم الانتهاء!",

  askKind:
    "🤔 لم أستطع تحديد نوع هذا الملف بثقة.\n\nكيف تريد أن أجهّزه؟",

  questionsReady: (count: number) =>
    "🎉 تم تجهيز ملف الأسئلة بنجاح\n\n" +
    `عدد الأسئلة: ${count}\n` +
    "يمكنك الآن بدء الدراسة من NiroLearn.",

  questionsReadyPartial: (count: number) =>
    "🎉 ملف الأسئلة جاهز\n\n" +
    `عدد الأسئلة: ${count}\n` +
    "بعض الشروح ما زالت تُجهَّز وستظهر تباعًا.",

  noQuestions:
    "⚠️ قرأنا الملف لكن لم نعثر فيه على أسئلة.\n\n" +
    "إن كان كتابًا أو ملخصًا، أرسله مرة ثانية بعد اختيار «رفع كتاب».",

  bookReady: (pages: number) =>
    "📚 تم تجهيز كتابك بنجاح\n\n" +
    (pages > 0 ? `عدد الصفحات: ${pages}\n` : "") +
    "تمت إضافة الكتاب إلى كتبك.",

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
  linkInvalid:
    "⚠️ رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من صفحة حسابك في NiroLearn.",
  linkElsewhere: "⚠️ حساب Telegram هذا مربوط بحساب NiroLearn آخر.",
  linkAccountBusy: "⚠️ حسابك في NiroLearn مربوط بحساب Telegram آخر. افصله أولًا من صفحة حسابك.",
} as const;

export const LABELS = {
  startQuestions: "🚀 ابدأ الأسئلة",
  openBook: "📖 افتح الكتاب",
  openSite: "🌐 فتح NiroLearn",
  uploadFromSite: "🌐 ارفعه من الموقع",
  connectAccount: "🔗 تسجيل الدخول / إنشاء حساب",
  retry: "🔄 إعادة المحاولة",
  asQuestions: "📄 ملف أسئلة",
  asBook: "📚 كتاب",
} as const;

// callback_data is limited to 64 bytes: a short tag + the upload's uuid.
export const CALLBACK = {
  kind: (uploadId: string, kind: DocumentKind) =>
    `k:${kind === "question_file" ? "q" : "b"}:${uploadId}`,
  retry: (uploadId: string) => `r:${uploadId}`,
};

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseCallback(
  data: string
):
  | { action: "kind"; uploadId: string; kind: DocumentKind }
  | { action: "retry"; uploadId: string }
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
  return null;
}

export function filePath(kind: DocumentKind, bookId: string): string {
  return kind === "question_file"
    ? `/books/question-files/${bookId}`
    : `/books/${bookId}`;
}
