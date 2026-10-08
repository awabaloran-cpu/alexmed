// Question-block parsing — the innermost stage of the question-file
// pipeline (lib/question-document.ts runs it on the cleaned, segmented,
// re-lined QUESTION SECTION only; never on a cover, front matter or an
// answer key). Pure text parsing, no I/O, no AI: it only ever splits what
// the file states into stem / options / answer / explanation / notes, and
// never invents a missing part.
//
// Within one question block:
//   stem → options (A, B, C… in order; or 1, 2, 3… when the file numbers
//   its options) → answer / explanation / notes.
// Once the answer, explanation or a note has started, a lettered line is
// NOT a new option ("Note A: …", "A) is wrong because …" stay notes /
// explanation).
//
// Bilingual files: an Arabic block after the English one (question, then
// أ/ب/ج/د or ١/٢/٣/٤ options, then "الإجابة: ب") is split into
// questionTextAr + optionsAr, and its answer line only ever feeds the
// answer. An Arabic block numbered like the English one is its translation,
// never a second question.

export type ExtractedQuestionInput = {
  orderIndex: number;
  questionText: string;
  options: string[] | null;
  extractedAnswerIndex: number | null;
  extractedAnswerText: string | null;
  explanationText: string | null;
  sourcePage: number;
  // The file's own Arabic version, when it has one (null otherwise).
  // optionsAr is only set when it lines up 1:1 with `options`.
  questionTextAr: string | null;
  optionsAr: string[] | null;
};

// What the parser knows beyond the stored fields — used by the document
// stage for answer keys, validation and image association; never stored.
export type ParsedQuestion = ExtractedQuestionInput & {
  number: number;
  endPage: number;
  notes: string[];
  // Position in the stream, to match answer-key blocks to the run of
  // questions they follow.
  streamIndex: number;
  // Structural warnings noticed while parsing (validation input).
  flags: string[];
};

export type AnswerKeyEntry = { number: number; answer: string };

export type StreamLine = { page: number; text: string; index: number };

const QUESTION_START =
  /^\s*(?:(?:question|q)\s*\.?\s*)?(\d{1,3})\s*[.):\-]\s+(.+)$/i;
// "Question 12" / "12." on a line of its own (the stem, if any, follows on
// the next lines; a block with none is caught by validation).
const QUESTION_HEADING =
  /^\s*(?:(?:question|q)\s*\.?\s*(\d{1,3})\s*[.):\-]?|(\d{1,3})\s*[.)])\s*$/i;
const OPTION_LINE = /^\s*(?:\(([A-Ha-h])\)|([A-Ha-h])\s?[.):])\s+(.+)$/;
const ANSWER_LINE =
  /^\s*(?:the\s+)?(?:correct\s+answer|right\s+answer|answer|ans|key|الإجابة الصحيحة|الإجابة|الجواب)\s*(?:is\s*)?[:\-.]?\s+(.+)$/i;
const ANSWER_LINE_STRICT =
  /^\s*(?:the\s+)?(?:correct\s+answer|right\s+answer|answer|ans|key|الإجابة الصحيحة|الإجابة|الجواب)\s*(?:is\s*)?[:\-.]\s*(.+)$/i;
const EXPLANATION_LINE =
  /^\s*(?:explanation|rationale|why|comments?|discussion|reasoning|reason|التفسير|الشرح|السبب|التعليل)\s*[:\-]\s*(.*)$/i;
const EXPLANATION_HEADING =
  /^\s*(?:explanation|rationale|comments?|discussion|التفسير|الشرح|التعليل)\s*:?\s*$/i;
const NOTE_LINE =
  /^\s*(?:note|notes|n\.?\s?b\.?|tip|remember|important|ملاحظة|ملاحظات)\b(?:\s*\(?[A-Ha-h0-9]\)?)?\s*[:\-.]?\s*(.*)$/i;
// "1. B" / "12) c" / "3 - D": an answer-key entry, never a question.
const KEY_ENTRY_BODY = /^\(?([A-Ha-h])\)?\s*\.?$/;
const ARABIC_OPTION_LINE =
  /^\s*\(?([أاإبجده]|[١-٥]|[1-5]|[A-Ea-e])\)?\s*[.)\-:ـ]?\s+(.+)$/;
const ARABIC_LETTER_OPTION = /^\s*(?:\([أاإبجده]\)|[أاإبجده]\s?[.):\-])\s*(?=\S)/;
const INLINE_ARABIC_ANSWER =
  /\s*(?:الإجابة الصحيحة|الإجابة|الجواب)\s*[:\-]\s*(\(?[أاإبجدA-Da-d١-٤1-4]\)?\.?)\s*$/;

const ARABIC_LETTER_TO_INDEX: Record<string, number> = {
  أ: 0,
  ا: 0,
  إ: 0,
  ب: 1,
  ج: 2,
  د: 3,
  ه: 4,
};
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩]/g, d => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

export function letterToIndex(letter: string): number | null {
  const trimmed = toAsciiDigits(letter.trim());
  const upper = trimmed.toUpperCase();
  if (upper.length === 1 && upper >= "A" && upper <= "H") {
    return upper.charCodeAt(0) - "A".charCodeAt(0);
  }
  if (/^[1-8]$/.test(trimmed)) return Number(trimmed) - 1;
  const arabic = ARABIC_LETTER_TO_INDEX[trimmed];
  return arabic ?? null;
}

const ARABIC_CHAR = /[؀-ۿ]/g;
const LATIN_CHAR = /[A-Za-z]/g;

// Mostly-Arabic text (English medical terms inside an Arabic sentence don't
// make it English).
export function isArabicText(text: string): boolean {
  const arabic = text.match(ARABIC_CHAR)?.length ?? 0;
  const latin = text.match(LATIN_CHAR)?.length ?? 0;
  return arabic > 0 && arabic >= latin;
}

// The first real letter after an optional "12." / "A)" / "(ب)" marker.
function startsInArabic(line: string): boolean {
  const body = line.replace(/^\s*\(?[\dA-Za-z٠-٩]{1,3}\)?[.)\-:]\s*/, "");
  const first = body.match(/[A-Za-z؀-ۿ]/);
  return !!first && /[؀-ۿ]/.test(first[0]);
}

// "Radial nerve العصب الكعبري" → { en: "Radial nerve", ar: "العصب الكعبري" }
// when an English line carries its Arabic translation at the end.
function splitBilingual(text: string): { en: string; ar: string | null } {
  const firstArabic = text.search(/[؀-ۿ]/);
  if (firstArabic <= 0) return { en: text, ar: null };
  // Cut right after the last English word before the Arabic starts, so
  // numbers / punctuation that open the Arabic part stay with it.
  const beforeArabic = text.slice(0, firstArabic);
  const lastLatin = beforeArabic.search(/[A-Za-z][^A-Za-z]*$/);
  if (lastLatin < 0) return { en: text, ar: null };
  const wordEnd = beforeArabic.slice(lastLatin).search(/\s/);
  const cut = wordEnd < 0 ? firstArabic : lastLatin + wordEnd;
  const en = text
    .slice(0, cut)
    .replace(/[\s/|–—-]+$/, "")
    .trim();
  const ar = text
    .slice(cut)
    .replace(/^[\s/|–—-]+/, "")
    .trim();
  if ((en.match(LATIN_CHAR)?.length ?? 0) < 2 || !isArabicText(ar)) {
    return { en: text, ar: null };
  }
  return { en, ar };
}

// An answer as written — "B", "(b)", "B. Note: …", "ب", or the option's
// full text — resolved against the question's own options. A trailing
// note / explanation on the same line ("B. Note: …") is handed back as
// `rest` so it lands in notes, never in the answer.
export function resolveAnswer(
  raw: string,
  options: string[]
): { index: number | null; text: string; rest: string } {
  const trimmed = raw.trim();
  const lead = trimmed.match(
    /^\(?([A-Ha-hأاإبجد١-٨])\)?(?=$|[\s.):\-,])[\s.):\-,]*(.*)$/
  );
  if (lead) {
    const index = letterToIndex(lead[1]);
    if (index !== null && index < options.length) {
      const rest = lead[2].trim();
      // "B. Stillbirth and live birth." restates the option; anything else
      // after the letter is a note / explanation.
      const restatesOption =
        !!rest &&
        normalize(options[index]).startsWith(normalize(rest).slice(0, 40));
      return {
        index,
        text: options[index],
        rest: restatesOption ? "" : rest,
      };
    }
  }
  const wanted = normalize(trimmed);
  const byText = options.findIndex(option => normalize(option) === wanted);
  if (byText !== -1) return { index: byText, text: options[byText], rest: "" };
  return { index: null, text: trimmed, rest: "" };
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// An answer-key entry: "1. B", "12) c", "3 - D", "Q4: A".
export function parseKeyEntry(line: string): AnswerKeyEntry | null {
  const start = toAsciiDigits(line).match(QUESTION_START);
  if (!start) return null;
  const body = start[2].trim();
  const key = body.match(KEY_ENTRY_BODY);
  return key ? { number: Number(start[1]), answer: key[1] } : null;
}

type Draft = {
  number: number;
  questionLines: string[];
  options: string[];
  // The file numbers its options 1., 2., 3. instead of A., B., C.
  numberedOptions: boolean;
  answerRaw: string | null;
  // An Arabic answer line only counts when the English gave none.
  answerFromArabic: boolean;
  explanationLines: string[];
  notes: string[];
  sourcePage: number;
  endPage: number;
  streamIndex: number;
  flags: string[];
  // Past the options: a lettered line is no longer an option.
  pastOptions: boolean;
  // The question itself is Arabic (an Arabic-only file): its Arabic
  // options are the options, and there's nothing to translate.
  primaryArabic: boolean;
  arQuestionLines: string[];
  arOptions: string[];
  // Arabic carried at the end of English option lines.
  inlineArOptions: string[];
  // Inside the Arabic block that follows the English one.
  inArabicBlock: boolean;
};

type Mode = "stem" | "options" | "explanation" | "notes";

const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.]+$/, "")
    .trim();

// An "Answer: C. <the option's text>" line long enough to wrap leaves its
// last words on the next line ("…reflux should be" / "considered"). Those
// words are the end of the answer, not an explanation: when everything
// after the answer is just the tail of the chosen option's own text, there
// is no explanation.
function explanationWithoutAnswerWrap(
  explanation: string,
  answerIndex: number | null,
  options: string[] | null
): string | null {
  if (!explanation) return null;
  const option = answerIndex === null ? null : options?.[answerIndex];
  if (option && comparable(option).endsWith(comparable(explanation))) {
    return null;
  }
  return explanation;
}

export function parseQuestionStream(
  lines: StreamLine[],
  hooks: { onKeyEntry?: (entry: AnswerKeyEntry, index: number) => void } = {}
): ParsedQuestion[] {
  const results: ParsedQuestion[] = [];
  let draft: Draft | null = null;
  let mode: Mode = "stem";

  function flush() {
    if (!draft) return;
    const questionText = draft.questionLines.join(" ").trim();
    if (questionText || draft.options.length) {
      const options = draft.options.length ? draft.options : null;
      const answer = draft.answerRaw
        ? resolveAnswer(draft.answerRaw, draft.options)
        : null;
      if (answer?.rest) {
        if (NOTE_LINE.test(answer.rest)) draft.notes.unshift(answer.rest);
        else draft.explanationLines.unshift(answer.rest);
      }
      const arText = draft.arQuestionLines.join(" ").trim();
      const arOptionsSource = draft.arOptions.length
        ? draft.arOptions
        : draft.inlineArOptions;
      results.push({
        orderIndex: results.length,
        number: draft.number,
        questionText,
        options,
        extractedAnswerIndex: answer?.index ?? null,
        extractedAnswerText: answer ? answer.text : null,
        explanationText: explanationWithoutAnswerWrap(
          draft.explanationLines.join(" ").trim(),
          answer?.index ?? null,
          options
        ),
        notes: draft.notes,
        sourcePage: draft.sourcePage,
        endPage: draft.endPage,
        streamIndex: draft.streamIndex,
        flags: draft.flags,
        questionTextAr: draft.primaryArabic ? null : arText || null,
        optionsAr:
          !draft.primaryArabic &&
          options &&
          arOptionsSource.length === options.length
            ? arOptionsSource
            : null,
      });
    }
    draft = null;
    mode = "stem";
  }

  function setAnswer(raw: string, fromArabic: boolean) {
    if (!draft) return;
    // The English answer always wins; an Arabic one only fills a gap.
    if (fromArabic && draft.answerRaw && !draft.answerFromArabic) return;
    draft.answerRaw = raw.trim();
    draft.answerFromArabic = fromArabic;
    draft.pastOptions = true;
  }

  function startQuestion(
    number: number,
    body: string,
    arabic: boolean,
    line: StreamLine
  ) {
    flush();
    const split: { en: string; ar: string | null } = arabic
      ? { en: body, ar: null }
      : splitBilingual(body);
    draft = {
      number,
      questionLines: split.en ? [split.en] : [],
      options: [],
      numberedOptions: false,
      answerRaw: null,
      answerFromArabic: false,
      explanationLines: [],
      notes: [],
      sourcePage: line.page,
      endPage: line.page,
      streamIndex: line.index,
      flags: [],
      pastOptions: false,
      primaryArabic: arabic,
      arQuestionLines: split.ar ? [split.ar] : [],
      arOptions: [],
      inlineArOptions: [],
      inArabicBlock: false,
    };
    mode = "stem";
  }

  for (const line of lines) {
    let text = line.text.trim();
    if (!text) continue;
    const current = draft as Draft | null;
    if (current) current.endPage = line.page;
    const arabic: boolean =
      isArabicText(text) &&
      (!!current?.inArabicBlock ||
        !!current?.primaryArabic ||
        startsInArabic(text));

    // "… الإجابة: ب" at the end of an Arabic line: answer only, never text.
    if (arabic && current) {
      const inline = text.match(INLINE_ARABIC_ANSWER);
      if (inline && inline.index && inline.index > 0) {
        setAnswer(inline[1].replace(/[().]/g, ""), true);
        text = text.slice(0, inline.index).trim();
        if (!text) continue;
      }
    }

    // An answer-key entry ("7. C") is never a question.
    const keyEntry = !arabic ? parseKeyEntry(text) : null;
    if (keyEntry) {
      hooks.onKeyEntry?.(keyEntry, line.index);
      continue;
    }

    const heading = !arabic ? text.match(QUESTION_HEADING) : null;
    if (heading) {
      startQuestion(Number(heading[1] ?? heading[2]), "", false, line);
      continue;
    }

    const questionStart = toAsciiDigits(text).match(QUESTION_START);
    if (questionStart) {
      const number = Number(questionStart[1]);
      const body = text
        .replace(
          /^\s*(?:(?:question|q)\s*\.?\s*)?[\d٠-٩]{1,3}\s*[.):\-]\s+/i,
          ""
        )
        .trim();
      // Inside the Arabic block, "1. … 2. … 3. …" counting up from the
      // options already seen are its numbered OPTIONS, not new questions.
      if (
        arabic &&
        current?.inArabicBlock &&
        number === current.arOptions.length + 1 &&
        number <= 5
      ) {
        current.arOptions.push(body);
        continue;
      }
      // An Arabic block right after an English question — numbered the
      // same, or restarting the count — is its translation.
      if (
        arabic &&
        current &&
        !current.primaryArabic &&
        current.questionLines.length &&
        !current.inArabicBlock &&
        (current.options.length > 0 || current.answerRaw !== null) &&
        (number === current.number || number === 1)
      ) {
        current.inArabicBlock = true;
        current.arQuestionLines = [body];
        continue;
      }
      if (current && !arabic && !current.pastOptions) {
        // A stem with no options yet, then "1." — the file numbers its
        // options; so do the "2.", "3." that follow.
        if (
          number === 1 &&
          current.number !== 0 &&
          current.questionLines.length &&
          current.options.length === 0
        ) {
          current.numberedOptions = true;
        }
        if (
          current.numberedOptions &&
          number === current.options.length + 1 &&
          number <= 8
        ) {
          current.options.push(splitBilingual(body).en);
          mode = "options";
          continue;
        }
      }
      // Inside an explanation / notes, a numbered list item stays there
      // unless it is the next question number.
      if (
        current &&
        (mode === "explanation" || mode === "notes") &&
        number !== current.number + 1 &&
        number !== 1
      ) {
        (mode === "notes" ? current.notes : current.explanationLines).push(
          text
        );
        continue;
      }
      startQuestion(number, body, arabic, line);
      continue;
    }
    if (!current) continue; // Text before the first question — skip.

    const answerMatch =
      text.match(ANSWER_LINE_STRICT) ??
      (current.options.length ? text.match(ANSWER_LINE) : null);
    if (answerMatch) {
      setAnswer(answerMatch[1], arabic || /^\s*ال/.test(text));
      mode = "notes";
      continue;
    }

    if (EXPLANATION_HEADING.test(text)) {
      current.pastOptions = true;
      mode = "explanation";
      continue;
    }
    const explanationMatch = text.match(EXPLANATION_LINE);
    if (explanationMatch) {
      if (explanationMatch[1].trim()) {
        current.explanationLines.push(explanationMatch[1].trim());
      }
      current.pastOptions = true;
      mode = "explanation";
      continue;
    }
    if (current.pastOptions || current.options.length) {
      const note = text.match(NOTE_LINE);
      if (note && /^\s*[A-Za-z؀-ۿ]/.test(text) && !OPTION_LINE.test(text)) {
        current.notes.push(text.trim());
        current.pastOptions = true;
        mode = "notes";
        continue;
      }
    }

    // An Arabic question's أ/ب/ج/د option whose text is English
    // ("أ) Aspirin") is still one of its options.
    if (
      current.primaryArabic &&
      !current.pastOptions &&
      ARABIC_LETTER_OPTION.test(text)
    ) {
      current.options.push(text.replace(ARABIC_LETTER_OPTION, "").trim());
      mode = "options";
      continue;
    }

    // Arabic options: of an Arabic-only question, or of the Arabic block.
    if (arabic && (current.primaryArabic || current.inArabicBlock)) {
      const arOption = toAsciiDigits(text).match(ARABIC_OPTION_LINE);
      const target = current.primaryArabic
        ? current.options
        : current.arOptions;
      if (arOption && isArabicText(arOption[2])) {
        target.push(
          text
            .replace(
              /^\s*\(?([أاإبجده]|[١-٥]|[1-5]|[A-Ea-e])\)?\s*[.)\-:ـ]?\s+/,
              ""
            )
            .trim()
        );
        continue;
      }
    }

    const optionMatch =
      !arabic && !current.pastOptions && !current.numberedOptions
        ? text.match(OPTION_LINE)
        : null;
    if (optionMatch) {
      const letter = (optionMatch[1] ?? optionMatch[2]).toLowerCase();
      const expected = "abcdefgh"[current.options.length];
      if (letter === expected) {
        const { en, ar } = splitBilingual(optionMatch[3].trim());
        current.options.push(en);
        if (ar) current.inlineArOptions.push(ar);
        mode = "options";
        continue;
      }
      // Out of order (B, C before any A; A after D…): noted for validation,
      // and the line is neither an option nor glued onto the last one.
      if (mode === "options" || current.options.length || letter !== "a") {
        current.flags.push("option_sequence_broken");
        continue;
      }
    }

    // An Arabic line right after the English options / answer (before any
    // explanation or note) opens the question's Arabic block; inside the
    // block, Arabic lines continue it.
    if (
      arabic &&
      !current.primaryArabic &&
      (current.inArabicBlock ||
        ((mode === "options" || mode === "notes") &&
          !current.notes.length &&
          !current.explanationLines.length))
    ) {
      if (current.inArabicBlock) {
        if (current.arOptions.length === 0) current.arQuestionLines.push(text);
        else current.arOptions[current.arOptions.length - 1] += ` ${text}`;
      } else {
        current.inArabicBlock = true;
        current.arQuestionLines = [text];
      }
      continue;
    }

    // A continuation line with no marker of its own — attach it to
    // whichever section we most recently saw.
    if (mode === "explanation") {
      current.explanationLines.push(text);
      continue;
    }
    if (mode === "notes") {
      if (current.notes.length) {
        current.notes[current.notes.length - 1] += ` ${text}`;
      } else {
        current.explanationLines.push(text);
      }
      continue;
    }
    if (arabic && !current.primaryArabic) {
      if (current.inArabicBlock) {
        if (current.arOptions.length === 0) current.arQuestionLines.push(text);
        else current.arOptions[current.arOptions.length - 1] += ` ${text}`;
      } else if (current.options.length > 0 || current.answerRaw !== null) {
        // An unnumbered Arabic block after the English options/answer.
        current.inArabicBlock = true;
        current.arQuestionLines = [text];
      } else {
        // The Arabic stem sitting between the English stem and options.
        current.arQuestionLines.push(text);
      }
      continue;
    }
    if (mode === "options" && current.options.length) {
      // A wrapped option: its text continues on the next line.
      const { en, ar } = splitBilingual(text);
      current.options[current.options.length - 1] += ` ${en}`;
      if (ar && current.inlineArOptions.length) {
        current.inlineArOptions[current.inlineArOptions.length - 1] += ` ${ar}`;
      }
      continue;
    }
    if (current.options.length === 0) {
      if (current.primaryArabic) {
        current.questionLines.push(text);
      } else {
        const { en, ar } = splitBilingual(text);
        current.questionLines.push(en);
        if (ar) current.arQuestionLines.push(ar);
      }
    }
  }
  flush();

  return results;
}
