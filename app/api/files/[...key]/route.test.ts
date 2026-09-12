import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-file-access", () => ({
  isFileKeyAccessibleToUser: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  storageGetSignedUrl: vi
    .fn()
    .mockResolvedValue("https://signed.example/file.pdf"),
}));

import { auth } from "@/lib/auth";
import { isFileKeyAccessibleToUser } from "@/lib/db-file-access";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockAllowed = isFileKeyAccessibleToUser as unknown as ReturnType<
  typeof vi.fn
>;

function requestFor(key: string[]) {
  return GET(new Request("http://localhost/api/files/" + key.join("/")), {
    params: Promise.resolve({ key }),
  });
}

describe("GET /api/files/[...key]", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockAllowed.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@example.com" } });
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await requestFor(["study-pdfs", "a.pdf"]);
    expect(response.status).toBe(401);
    expect(mockAllowed).not.toHaveBeenCalled();
  });

  // Never leaks whether a key belonging to a different user's book/deck/job
  // even exists — a wrong key and someone else's real key look identical.
  it("returns 404 for a key the caller is not authorized to read", async () => {
    mockAllowed.mockResolvedValue(false);
    const response = await requestFor(["book-pdfs", "someone-elses.pdf"]);
    expect(response.status).toBe(404);
    expect(mockAllowed).toHaveBeenCalledWith(
      "u1",
      "book-pdfs/someone-elses.pdf"
    );
  });

  it("redirects to a signed URL for a key the caller is authorized to read", async () => {
    mockAllowed.mockResolvedValue(true);
    const response = await requestFor(["book-pdfs", "mine.pdf"]);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://signed.example/file.pdf"
    );
  });
});
