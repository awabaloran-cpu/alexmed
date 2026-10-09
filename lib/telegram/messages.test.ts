import { describe, expect, it } from "vitest";
import { BUTTONS, TEXT } from "./messages";

// A student who taps one of the three ways in is told what to send and
// what comes back, so a lecture is not sent as a question file.
describe("what the bot says when a kind of upload is chosen", () => {
  it("a question file: it must hold questions, and where a lecture goes", () => {
    const text = TEXT.askForFile("question_file");
    expect(text).toContain("يجب أن يحتوي الملف على أسئلة");
    expect(text).toContain("اختبار تفاعلي");
    expect(text).toContain(BUTTONS.uploadBook);
  });

  it("a book: cards, questions and a mind map, and where questions go", () => {
    const text = TEXT.askForFile("book");
    for (const made of ["بطاقات", "أسئلة اختبار", "خريطة ذهنية"]) {
      expect(text).toContain(made);
    }
    expect(text).toContain(BUTTONS.uploadQuestions);
  });

  it("a summary: one PDF, and nothing else", () => {
    expect(TEXT.summaryAskFile).toContain("ملف PDF واحد");
    expect(TEXT.summaryAskFile).toContain("بلا اختبار ولا بطاقات");
  });

  it("stays within Telegram's message length", () => {
    for (const text of [
      TEXT.welcome,
      TEXT.howItWorks,
      TEXT.askForFile("question_file"),
      TEXT.askForFile("book"),
      TEXT.summaryAskFile,
    ]) {
      expect(text.length).toBeLessThan(4096);
    }
  });
});
