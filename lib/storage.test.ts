import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", async importOriginal => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { deleteObject, deleteObjects } from "./storage";
import { DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

describe("storage delete helpers", () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";
    process.env.STORAGE_BUCKET = "test-bucket";
    process.env.STORAGE_ACCESS_KEY = "key";
    process.env.STORAGE_SECRET_KEY = "secret";
  });

  it("deletes a single object by its normalized key", async () => {
    mockSend.mockResolvedValue({});
    await deleteObject("/books/abc.pdf");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "books/abc.pdf",
    });
  });

  // "آمناً إذا كان الملف غير موجود" — S3-compatible DELETE is inherently
  // idempotent (no distinct "not found" error), so a successful send() with
  // an empty response must not throw.
  it("does not throw when the object is already gone", async () => {
    mockSend.mockResolvedValue({});
    await expect(
      deleteObject("books/already-gone.pdf")
    ).resolves.toBeUndefined();
  });

  it("logs and re-throws when the delete request itself fails", async () => {
    const error = new Error("network error");
    mockSend.mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deleteObject("books/abc.pdf")).rejects.toThrow(
      "network error"
    );
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("is a no-op for an empty key list, without calling S3 at all", async () => {
    await deleteObjects([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("deduplicates keys before issuing a bulk delete", async () => {
    mockSend.mockResolvedValue({});
    await deleteObjects(["books/a.pdf", "books/a.pdf", "books/b.png"]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectsCommand);
    expect(command.input.Delete.Objects).toEqual([
      { Key: "books/a.pdf" },
      { Key: "books/b.png" },
    ]);
  });

  // Never allowed to block/fail the DB deletion that already committed
  // (lib/db-books.ts's deleteBook) — a partial per-key failure inside an
  // otherwise-successful response is logged, not thrown.
  it("logs (but does not throw) per-key errors reported inside a successful response", async () => {
    mockSend.mockResolvedValue({
      Errors: [{ Key: "books/locked.pdf", Code: "AccessDenied" }],
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deleteObjects(["books/locked.pdf"])).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
