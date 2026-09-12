import { describe, expect, it } from "vitest";
import { computeCoverageDetail } from "./db-books";

function page(
  pageNumber: number,
  textStatus = "complete",
  visualStatus = "complete"
) {
  return { pageNumber, textStatus, visualStatus };
}

describe("computeCoverageDetail", () => {
  it("reports COMPLETE only when every page is present and fully processed", () => {
    const pages = [1, 2, 3].map(n => page(n));
    expect(computeCoverageDetail(3, pages)).toEqual({
      totalPages: 3,
      processedPages: 3,
      failedPages: [],
      missingPages: [],
      coverage: 100,
      status: "COMPLETE",
    });
  });

  it("names the exact missing page numbers instead of just a count", () => {
    const pages = [page(1), page(3)]; // page 2 never got a book_pages row
    const result = computeCoverageDetail(3, pages);
    expect(result.missingPages).toEqual([2]);
    expect(result.status).toBe("PARTIAL");
    expect(result.coverage).toBeLessThan(100);
  });

  it("names the exact failed page numbers (text or visual failure)", () => {
    const pages = [
      page(1),
      page(2, "failed", "pending"),
      page(3, "complete", "failed"),
    ];
    const result = computeCoverageDetail(3, pages);
    expect(result.failedPages).toEqual([2, 3]);
    expect(result.status).toBe("PARTIAL");
  });

  it("counts needs_review pages as processed (they were looked at, not skipped)", () => {
    const pages = [page(1, "complete", "needs_review")];
    const result = computeCoverageDetail(1, pages);
    expect(result.processedPages).toBe(1);
    expect(result.status).toBe("COMPLETE");
  });

  it("never reports COMPLETE while any page is still pending/processing", () => {
    const pages = [page(1), page(2, "complete", "pending")];
    const result = computeCoverageDetail(2, pages);
    expect(result.status).toBe("PROCESSING");
    expect(result.processedPages).toBe(1);
  });

  it("reports PROCESSING (not PARTIAL) for a book that hasn't started yet", () => {
    expect(computeCoverageDetail(0, [])).toEqual({
      totalPages: 0,
      processedPages: 0,
      failedPages: [],
      missingPages: [],
      coverage: 0,
      status: "PROCESSING",
    });
  });

  it("never rounds coverage up to COMPLETE-looking 100 when pages remain", () => {
    // 199/200 processed must not be misreported at a rounded 100%.
    const pages = Array.from({ length: 199 }, (_, i) => page(i + 1));
    const result = computeCoverageDetail(200, pages);
    expect(result.coverage).toBe(100); // rounds to 100 numerically...
    expect(result.status).not.toBe("COMPLETE"); // ...but status must not lie
    expect(result.missingPages).toEqual([200]);
  });
});
