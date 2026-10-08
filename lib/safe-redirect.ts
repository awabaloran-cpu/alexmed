// Where to send someone after they sign in or register, taken from a
// `callbackUrl` query parameter — which anyone can put in a link. Only a
// path on this site is accepted: one leading slash, and none of the forms a
// browser could read as another host ("//host", "/\host", a control
// character). Anything else falls back to the app home.
//
// No server imports: used by client forms and by server code alike.
export const DEFAULT_AFTER_AUTH = "/subjects";

export function safeCallbackUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return DEFAULT_AFTER_AUTH;
  if (value.startsWith("//") || value.includes("\\")) return DEFAULT_AFTER_AUTH;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_AFTER_AUTH;
  return value;
}
