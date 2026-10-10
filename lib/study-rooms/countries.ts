// The countries a student can pick (ISO 3166-1 alpha-2). Arab countries
// first, in the order students of this platform are most likely to look
// for them; "other" countries can be added here without a migration.
export const COUNTRIES: { code: string; ar: string; en: string }[] = [
  { code: "EG", ar: "مصر", en: "Egypt" },
  { code: "SA", ar: "السعودية", en: "Saudi Arabia" },
  { code: "JO", ar: "الأردن", en: "Jordan" },
  { code: "IQ", ar: "العراق", en: "Iraq" },
  { code: "SY", ar: "سوريا", en: "Syria" },
  { code: "PS", ar: "فلسطين", en: "Palestine" },
  { code: "LB", ar: "لبنان", en: "Lebanon" },
  { code: "AE", ar: "الإمارات", en: "UAE" },
  { code: "KW", ar: "الكويت", en: "Kuwait" },
  { code: "QA", ar: "قطر", en: "Qatar" },
  { code: "BH", ar: "البحرين", en: "Bahrain" },
  { code: "OM", ar: "عُمان", en: "Oman" },
  { code: "YE", ar: "اليمن", en: "Yemen" },
  { code: "LY", ar: "ليبيا", en: "Libya" },
  { code: "SD", ar: "السودان", en: "Sudan" },
  { code: "TN", ar: "تونس", en: "Tunisia" },
  { code: "DZ", ar: "الجزائر", en: "Algeria" },
  { code: "MA", ar: "المغرب", en: "Morocco" },
  { code: "MR", ar: "موريتانيا", en: "Mauritania" },
  { code: "SO", ar: "الصومال", en: "Somalia" },
  { code: "TR", ar: "تركيا", en: "Turkey" },
  { code: "DE", ar: "ألمانيا", en: "Germany" },
  { code: "GB", ar: "بريطانيا", en: "United Kingdom" },
  { code: "US", ar: "أمريكا", en: "United States" },
  { code: "CA", ar: "كندا", en: "Canada" },
  { code: "MY", ar: "ماليزيا", en: "Malaysia" },
];

const BY_CODE = new Map(COUNTRIES.map(country => [country.code, country]));

export function countryName(
  code: string | null | undefined,
  language: "ar" | "en"
): string {
  if (!code) return "";
  return BY_CODE.get(code.toUpperCase())?.[language] ?? code.toUpperCase();
}

// A phone number's calling code, as a first guess of the country.
const CALLING_CODES: [string, string][] = [
  ["+20", "EG"],
  ["+966", "SA"],
  ["+962", "JO"],
  ["+964", "IQ"],
  ["+963", "SY"],
  ["+970", "PS"],
  ["+961", "LB"],
  ["+971", "AE"],
  ["+965", "KW"],
  ["+974", "QA"],
  ["+973", "BH"],
  ["+968", "OM"],
  ["+967", "YE"],
  ["+218", "LY"],
  ["+249", "SD"],
  ["+216", "TN"],
  ["+213", "DZ"],
  ["+212", "MA"],
];

export function countryFromPhone(
  phone: string | null | undefined
): string | null {
  if (!phone) return null;
  const normalized = phone.startsWith("+") ? phone : `+${phone}`;
  return (
    CALLING_CODES.find(([prefix]) => normalized.startsWith(prefix))?.[1] ?? null
  );
}
