import { describe, expect, it } from "vitest";
import { computeBookRollupStatus } from "./db-books";

describe("computeBookRollupStatus", () => {
  it("skips a book that's already complete (truly terminal)", () => {
    expect(computeBookRollupStatus("complete", ["complete"], [])).toBe("skip");
  });

  it("skips a book with no chapters yet (still extracting)", () => {
    expect(computeBookRollupStatus("pending", [], [])).toBe("skip");
  });

  it("skips while any chapter is still being worked on", () => {
    expect(
      computeBookRollupStatus("pending", ["complete", "pending"], [])
    ).toBe("skip");
    expect(
      computeBookRollupStatus("pending", ["complete", "retrying"], [])
    ).toBe("skip");
  });

  it("skips while any page's visual analysis is still pending/processing", () => {
    expect(
      computeBookRollupStatus(
        "pending",
        ["complete"],
        [{ visualStatus: "pending", textStatus: "complete" }]
      )
    ).toBe("skip");
  });

  it("resolves to complete when everything succeeded", () => {
    expect(
      computeBookRollupStatus(
        "pending",
        ["complete"],
        [{ visualStatus: "complete", textStatus: "complete" }]
      )
    ).toBe("complete");
  });

  it("resolves to partial_failed when a page permanently failed text extraction", () => {
    expect(
      computeBookRollupStatus(
        "pending",
        ["complete"],
        [
          { visualStatus: "complete", textStatus: "complete" },
          { visualStatus: "complete", textStatus: "failed" },
        ]
      )
    ).toBe("partial_failed");
  });

  it("resolves to partial_failed when a chapter or a page visual failed", () => {
    expect(computeBookRollupStatus("pending", ["complete", "failed"], [])).toBe(
      "partial_failed"
    );
    expect(
      computeBookRollupStatus(
        "pending",
        ["complete"],
        [{ visualStatus: "failed", textStatus: "complete" }]
      )
    ).toBe("partial_failed");
  });

  it("does not force partial_failed for needs_review alone", () => {
    expect(
      computeBookRollupStatus(
        "pending",
        ["complete"],
        [{ visualStatus: "needs_review", textStatus: "complete" }]
      )
    ).toBe("complete");
  });

  // Regression for the bug found via a real-Postgres integration run: a
  // book already at "partial_failed" must still be re-evaluated (never
  // treated as terminal like "complete" is) — otherwise a student
  // successfully retrying their last failed page/chapter could never see
  // the book flip back to "complete".
  it("re-evaluates a partial_failed book and can resolve it to complete", () => {
    expect(
      computeBookRollupStatus(
        "partial_failed",
        ["complete"],
        [{ visualStatus: "complete", textStatus: "complete" }]
      )
    ).toBe("complete");
  });

  it("keeps a partial_failed book partial_failed if the failure hasn't resolved yet", () => {
    expect(
      computeBookRollupStatus(
        "partial_failed",
        ["complete"],
        [{ visualStatus: "complete", textStatus: "failed" }]
      )
    ).toBe("partial_failed");
  });
});
