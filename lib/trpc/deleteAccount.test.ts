import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({ signOut: vi.fn(), auth: vi.fn() }));
vi.mock("../db-account", () => ({ deleteAccountCompletely: vi.fn() }));
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserProfileForAccount: vi.fn(),
}));

import { deleteAccountCompletely } from "../db-account";
import { getUserProfileForAccount } from "../db";
import { appRouter } from "./router";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function caller(email = "Student@Example.com") {
  return appRouter.createCaller({
    user: { id: "user-1", email, role: "user" },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  m(deleteAccountCompletely).mockResolvedValue(true);
  // No profile row → the session's email is the identifier (email accounts).
  m(getUserProfileForAccount).mockResolvedValue(null);
});

describe("auth.deleteAccount (حذف حسابي)", () => {
  it("deletes only the signed-in account once its email is re-typed", async () => {
    await caller().auth.deleteAccount({
      confirmEmail: " student@example.com ",
    });
    expect(deleteAccountCompletely).toHaveBeenCalledWith("user-1");
  });

  it("refuses a wrong email and deletes nothing", async () => {
    await expect(
      caller().auth.deleteAccount({ confirmEmail: "someone@else.com" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteAccountCompletely).not.toHaveBeenCalled();
  });

  it("confirms a phone sign-up account (no email) by its number, typed any way", async () => {
    m(getUserProfileForAccount).mockResolvedValue({
      id: "user-1",
      email: null,
      phone: "+962791234567",
    });
    const phoneCaller = appRouter.createCaller({
      user: { id: "user-1", email: "", role: "user" },
    } as never);
    await expect(
      phoneCaller.auth.deleteAccount({ confirm: "0781234567" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteAccountCompletely).not.toHaveBeenCalled();

    await phoneCaller.auth.deleteAccount({ confirm: "079 123 4567" });
    expect(deleteAccountCompletely).toHaveBeenCalledWith("user-1");
  });

  it("requires a signed-in user", async () => {
    const anonymous = appRouter.createCaller({ user: null } as never);
    await expect(
      anonymous.auth.deleteAccount({ confirmEmail: "x@y.com" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(deleteAccountCompletely).not.toHaveBeenCalled();
  });
});
