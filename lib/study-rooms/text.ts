// One spelling for search and matching: «جامعة الإسكندريّة » and
// «جامعه الاسكندرية» are the same key, and so are "Pharmacology" and
// "pharmacology ". The original text is kept beside the key for display.
// The seed of drizzle/migrations/0047_study_rooms_core.sql was written with
// the same rules.
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "") // tashkeel and tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

// Trims and collapses whitespace; empty becomes null.
export function cleanText(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

// Words a public room's title may not carry. Deliberately short and plain:
// reports and admins do the real moderation.
const BLOCKED = ["sex", "porn", "xxx", "سكس", "نيك", "شرموط", "عاهر"];

export function titleIsAllowed(title: string): boolean {
  const key = ` ${normalizeKey(title)} `;
  // Whole words only: "Sexual reproduction" is a biology lecture.
  return !BLOCKED.some(word => key.includes(` ${normalizeKey(word)} `));
}

// A subject matches a query when its name or one of its aliases starts with
// it or contains it as a word.
export function subjectMatches(
  subject: { nameEn: string; nameAr: string; aliases: string[] },
  query: string
): boolean {
  const key = normalizeKey(query);
  if (!key) return true;
  const names = [
    normalizeKey(subject.nameEn),
    normalizeKey(subject.nameAr),
    ...subject.aliases,
  ];
  return names.some(
    name => name.startsWith(key) || ` ${name}`.includes(` ${key}`)
  );
}
