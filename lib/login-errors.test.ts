import { describe, expect, it } from "vitest";
import {
  GOOGLE_CANCELLED_MESSAGE_AR,
  GOOGLE_FAILED_MESSAGE_AR,
  loginErrorFromQuery,
  NOT_LINKED_MESSAGE_AR,
  SUSPENDED_MESSAGE_AR,
} from "./login-errors";

describe("what the login page says after a sign-in sends the student back", () => {
  it("says nothing when there is nothing to say", () => {
    expect(loginErrorFromQuery(null)).toBe("");
    expect(loginErrorFromQuery(undefined)).toBe("");
    expect(loginErrorFromQuery("")).toBe("");
    expect(loginErrorFromQuery("CredentialsSignin")).toBe("");
  });

  it("an email that already has a password account is told how to get in", () => {
    const message = loginErrorFromQuery("OAuthAccountNotLinked");
    expect(message).toBe(NOT_LINKED_MESSAGE_AR);
    expect(message).toContain("كلمة المرور");
    expect(message).toContain("Google");
  });

  it("keeps the suspended message", () => {
    expect(loginErrorFromQuery("account_suspended")).toBe(SUSPENDED_MESSAGE_AR);
  });

  it("a cancelled or refused Google sign-in is said as such", () => {
    expect(loginErrorFromQuery("AccessDenied")).toBe(
      GOOGLE_CANCELLED_MESSAGE_AR
    );
    expect(loginErrorFromQuery("OAuthCallbackError")).toBe(
      GOOGLE_CANCELLED_MESSAGE_AR
    );
  });

  it("no code ever comes back to a silent form", () => {
    for (const code of ["Configuration", "OAuthSignin", "Callback", "x"]) {
      expect(loginErrorFromQuery(code)).toBe(GOOGLE_FAILED_MESSAGE_AR);
    }
  });
});
