// The check route's own input validation — a real 6-digit code must reach
// the verification step (a broken code pattern once rejected every code).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db-phone", () => ({ checkPhoneVerification: vi.fn() }));
vi.mock("@/lib/sms/vonage", () => ({
  isSmsConfigured: () => true,
  SMS_CODE_LENGTH: 6,
}));

import { checkPhoneVerification } from "@/lib/db-phone";
import { POST } from "./route";

const check = checkPhoneVerification as unknown as ReturnType<typeof vi.fn>;
const ID = "d5842a8a-8697-4194-a71b-9dc6ba7185a3";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/phone-verification/check", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  check.mockReset();
  check.mockResolvedValue({ ok: true });
});

describe("POST /api/phone-verification/check", () => {
  it("passes a 6-digit code on to the verification", async () => {
    const response = await post({ verificationId: ID, code: "246810" });
    expect(response.status).toBe(200);
    expect(check).toHaveBeenCalledWith({ verificationId: ID, code: "246810" });
  });

  it("rejects malformed codes without calling the provider", async () => {
    for (const code of ["12345", "1234567", "12a456", ""]) {
      const response = await post({ verificationId: ID, code });
      expect(response.status, code).toBe(400);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it("returns the flow's error with its Arabic message", async () => {
    check.mockResolvedValue({ ok: false, error: "expired" });
    const response = await post({ verificationId: ID, code: "246810" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "expired" });
  });
});
