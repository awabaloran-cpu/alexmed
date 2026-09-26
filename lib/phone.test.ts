import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, looksLikePhone, parsePhone } from "./phone";

describe("parsePhone", () => {
  it("accepts every common way of typing a Jordanian mobile", () => {
    for (const input of [
      "0791234567",
      "791234567",
      "079 123 4567",
      "079-123-4567",
      "+962791234567",
      "+962 79 123 4567",
      "00962791234567",
      "962791234567",
      "+9620791234567",
      "٠٧٩١٢٣٤٥٦٧",
    ]) {
      expect(parsePhone(input, "JO"), input).toEqual({
        ok: true,
        e164: "+962791234567",
      });
    }
  });

  it("uses the selected country for local numbers", () => {
    expect(parsePhone("0501234567", "SA")).toEqual({
      ok: true,
      e164: "+966501234567",
    });
    expect(parsePhone("01012345678", "EG")).toEqual({
      ok: true,
      e164: "+201012345678",
    });
    expect(parsePhone("51234567", "KW")).toEqual({
      ok: true,
      e164: "+96551234567",
    });
  });

  it("rejects landlines, wrong lengths and junk", () => {
    expect(parsePhone("064123456", "JO").ok).toBe(false); // Amman landline
    expect(parsePhone("07912345", "JO").ok).toBe(false); // too short
    expect(parsePhone("079123456789", "JO").ok).toBe(false); // too long
    expect(parsePhone("abc", "JO").ok).toBe(false);
    expect(parsePhone("+1234", "JO").ok).toBe(false);
    expect(parsePhone("", "JO")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a full international number for an unlisted country", () => {
    expect(parsePhone("+447700900123", "JO")).toEqual({
      ok: true,
      e164: "+447700900123",
    });
  });

  it("tells phone logins from email logins", () => {
    expect(looksLikePhone("0791234567")).toBe(true);
    expect(looksLikePhone("+962 79 123 4567")).toBe(true);
    expect(looksLikePhone("student@example.com")).toBe(false);
    expect(looksLikePhone("ahmad")).toBe(false);
  });

  it("formats a number back for display", () => {
    expect(formatPhoneForDisplay("+962791234567")).toBe("+962 79 123 4567");
    expect(formatPhoneForDisplay("+201012345678")).toBe("+20 101 234 5678");
    expect(formatPhoneForDisplay("+96551234567")).toBe("+965 5123 4567");
    expect(formatPhoneForDisplay("+447700900123")).toBe("+447700900123");
  });
});
