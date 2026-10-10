// What the login page says when a sign-in sends the student back with
// ?error=… — the Google path does a full redirect, so the page is the only
// place the reason can be shown. Before this, every code but
// "account_suspended" came back to a silent form: a student whose email
// already had a password account pressed "Google", landed on the same page
// with nothing said, and pressed it again (seen live as repeated
// OAuthAccountNotLinked errors, 2026-10-10).
export const SUSPENDED_MESSAGE_AR =
  "حسابك معلّق حاليًا. تواصل مع الدعم إذا كنت تظن أن هذا خطأ.";

// The email is already an account with its own password. Auth.js refuses to
// attach Google to it on its own — deliberately: anyone could have opened
// that account with someone else's email, and attaching would hand them the
// real owner's sign-in.
export const NOT_LINKED_MESSAGE_AR =
  "هذا البريد مسجّل عندنا بكلمة مرور، وليس عبر Google. ادخل برقم هاتفك أو بريدك وكلمة المرور.";

export const GOOGLE_CANCELLED_MESSAGE_AR =
  "لم يكتمل الدخول عبر Google. حاول مرة أخرى.";

export const GOOGLE_FAILED_MESSAGE_AR =
  "تعذّر الدخول عبر Google الآن. حاول مرة أخرى، أو ادخل برقمك وكلمة المرور.";

// `code` is the ?error= value. Null/empty: nothing to say.
export function loginErrorFromQuery(code: string | null | undefined): string {
  switch (code) {
    case null:
    case undefined:
    case "":
      return "";
    case "account_suspended":
      return SUSPENDED_MESSAGE_AR;
    case "OAuthAccountNotLinked":
      return NOT_LINKED_MESSAGE_AR;
    // The student closed Google's window or refused the permission.
    case "AccessDenied":
    case "OAuthCallbackError":
      return GOOGLE_CANCELLED_MESSAGE_AR;
    // A wrong password never arrives here (that path does not redirect).
    case "CredentialsSignin":
      return "";
    default:
      return GOOGLE_FAILED_MESSAGE_AR;
  }
}
