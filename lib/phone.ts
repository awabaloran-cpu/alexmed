// 📱 Mobile numbers for phone sign-up / login. Everything stored and sent
// to the SMS provider is E.164 ("+962791234567"). Pure and dependency-free
// so the sign-up form and the server share one rule.
//
// The listed countries get a real mobile-number check (national length +
// mobile prefixes) and accept the local way of typing it (07…, 05…, with
// spaces/dashes, Arabic-Indic digits). Any other country can be typed in
// full international form (+…, 8–15 digits); the SMS provider rejects a
// number that doesn't exist.

export type PhoneCountry = {
  iso: string;
  dial: string; // without "+"
  nameAr: string;
  flag: string;
  // National significant number (no trunk "0"): its length and the
  // prefixes mobile numbers start with.
  length: number;
  mobilePrefixes: string[];
  example: string; // national form shown as the placeholder
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  {
    iso: "JO",
    dial: "962",
    nameAr: "الأردن",
    flag: "🇯🇴",
    length: 9,
    mobilePrefixes: ["77", "78", "79"],
    example: "07X XXX XXXX",
  },
  {
    iso: "SA",
    dial: "966",
    nameAr: "السعودية",
    flag: "🇸🇦",
    length: 9,
    mobilePrefixes: ["5"],
    example: "05X XXX XXXX",
  },
  {
    iso: "AE",
    dial: "971",
    nameAr: "الإمارات",
    flag: "🇦🇪",
    length: 9,
    mobilePrefixes: ["50", "52", "54", "55", "56", "58"],
    example: "05X XXX XXXX",
  },
  {
    iso: "KW",
    dial: "965",
    nameAr: "الكويت",
    flag: "🇰🇼",
    length: 8,
    mobilePrefixes: ["4", "5", "6", "9"],
    example: "5XXX XXXX",
  },
  {
    iso: "QA",
    dial: "974",
    nameAr: "قطر",
    flag: "🇶🇦",
    length: 8,
    mobilePrefixes: ["3", "5", "6", "7"],
    example: "3XXX XXXX",
  },
  {
    iso: "BH",
    dial: "973",
    nameAr: "البحرين",
    flag: "🇧🇭",
    length: 8,
    mobilePrefixes: ["3", "6"],
    example: "3XXX XXXX",
  },
  {
    iso: "OM",
    dial: "968",
    nameAr: "عُمان",
    flag: "🇴🇲",
    length: 8,
    mobilePrefixes: ["7", "9"],
    example: "9XXX XXXX",
  },
  {
    iso: "PS",
    dial: "970",
    nameAr: "فلسطين",
    flag: "🇵🇸",
    length: 9,
    mobilePrefixes: ["56", "59"],
    example: "059 XXX XXXX",
  },
  {
    iso: "LB",
    dial: "961",
    nameAr: "لبنان",
    flag: "🇱🇧",
    length: 8,
    mobilePrefixes: ["3", "70", "71", "76", "78", "79", "81"],
    example: "03 XXX XXX",
  },
  {
    iso: "SY",
    dial: "963",
    nameAr: "سوريا",
    flag: "🇸🇾",
    length: 9,
    mobilePrefixes: ["9"],
    example: "09XX XXX XXX",
  },
  {
    iso: "IQ",
    dial: "964",
    nameAr: "العراق",
    flag: "🇮🇶",
    length: 10,
    mobilePrefixes: ["7"],
    example: "07XX XXX XXXX",
  },
  {
    iso: "EG",
    dial: "20",
    nameAr: "مصر",
    flag: "🇪🇬",
    length: 10,
    mobilePrefixes: ["10", "11", "12", "15"],
    example: "01X XXXX XXXX",
  },
];

export const DEFAULT_PHONE_COUNTRY = "JO";

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function toAsciiDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, ch => {
    const code = ch.charCodeAt(0);
    // ٠ U+0660 … ٩ U+0669 ; ۰ U+06F0 … ۹ U+06F9
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function findCountry(iso: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find(country => country.iso === iso);
}

function isValidNational(country: PhoneCountry, national: string): boolean {
  return (
    national.length === country.length &&
    country.mobilePrefixes.some(prefix => national.startsWith(prefix))
  );
}

export type PhoneParseResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "empty" | "invalid" };

// Accepts what a student actually types — "0791234567", "79 123 4567",
// "+962 79 123 4567", "00962791234567", "٠٧٩١٢٣٤٥٦٧" — for the selected
// country, or a full international number for any country.
export function parsePhone(
  input: string,
  countryIso: string = DEFAULT_PHONE_COUNTRY
): PhoneParseResult {
  const cleaned = toAsciiDigits(input).replace(/[\s\-().]/g, "");
  if (!cleaned) return { ok: false, reason: "empty" };

  let international: string | null = null;
  if (cleaned.startsWith("+")) international = cleaned.slice(1);
  else if (cleaned.startsWith("00")) international = cleaned.slice(2);
  if (international !== null) {
    if (!/^\d{8,15}$/.test(international)) {
      return { ok: false, reason: "invalid" };
    }
    // A listed country gets its real rule; others the generic E.164 one.
    const digits = international;
    const country = PHONE_COUNTRIES.find(c => digits.startsWith(c.dial));
    if (country) {
      const national = digits.slice(country.dial.length).replace(/^0/, "");
      return isValidNational(country, national)
        ? { ok: true, e164: `+${country.dial}${national}` }
        : { ok: false, reason: "invalid" };
    }
    return { ok: true, e164: `+${digits}` };
  }

  if (!/^\d+$/.test(cleaned)) return { ok: false, reason: "invalid" };
  const country = findCountry(countryIso);
  if (!country) return { ok: false, reason: "invalid" };
  let national = cleaned;
  // The student typed the country code without "+" (962791234567).
  if (
    national.startsWith(country.dial) &&
    national.length > country.length + 1
  ) {
    national = national.slice(country.dial.length);
  }
  national = national.replace(/^0/, "");
  return isValidNational(country, national)
    ? { ok: true, e164: `+${country.dial}${national}` }
    : { ok: false, reason: "invalid" };
}

// True when a login identifier is a phone number rather than an email.
export function looksLikePhone(identifier: string): boolean {
  const value = toAsciiDigits(identifier).trim();
  return !value.includes("@") && /^[+\d][\d\s\-().]{5,}$/.test(value);
}

// "+962791234567" → "+962 79 123 4567", for showing a number back.
export function formatPhoneForDisplay(e164: string): string {
  const country = PHONE_COUNTRIES.find(c => e164.startsWith(`+${c.dial}`));
  if (!country) return e164;
  const national = e164.slice(country.dial.length + 1);
  // Local grouping: 9 digits → 2-3-4 (79 123 4567), 10 → 3-3-4, 8 → 4-4.
  const sizes =
    national.length === 8
      ? [4, 4]
      : national.length >= 9
        ? [national.length - 7, 3, 4]
        : [national.length];
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    parts.push(national.slice(at, at + size));
    at += size;
  }
  return `+${country.dial} ${parts.join(" ")}`;
}
