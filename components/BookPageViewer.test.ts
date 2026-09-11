import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { renderTextWithHighlights } from "./BookPageViewer";

describe("renderTextWithHighlights", () => {
  it("returns the plain text unchanged when there are no highlights", () => {
    expect(renderTextWithHighlights("hello world", [])).toBe("hello world");
  });

  it("wraps a single range in a <mark>, preserving text before/after", () => {
    const result = renderTextWithHighlights("hello world", [
      { start: 6, end: 11 },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const nodes = result as unknown as React.ReactNode[];
    expect(nodes[0]).toBe("hello ");
    expect(isValidElement(nodes[1])).toBe(true);
    const mark = nodes[1] as React.ReactElement<{ children: string }>;
    expect(mark.type).toBe("mark");
    expect(mark.props.children).toBe("world");
  });

  it("sorts out-of-order ranges before rendering", () => {
    const result = renderTextWithHighlights("abcdefgh", [
      { start: 4, end: 6 }, // "ef"
      { start: 0, end: 2 }, // "ab"
    ]) as unknown as React.ReactNode[];
    const marks = result.filter(isValidElement) as React.ReactElement<{
      children: string;
    }>[];
    expect(marks.map(m => m.props.children)).toEqual(["ab", "ef"]);
  });

  it("clamps a range that runs past the end of the text", () => {
    const result = renderTextWithHighlights("short", [
      { start: 2, end: 999 },
    ]) as unknown as React.ReactNode[];
    const mark = result.find(isValidElement) as React.ReactElement<{
      children: string;
    }>;
    expect(mark.props.children).toBe("ort");
  });

  it("clamps overlapping ranges instead of double-rendering shared text", () => {
    // Second range's start (1) falls inside the first range (0-4) — the
    // overlapping portion must not be rendered twice.
    const result = renderTextWithHighlights("abcdef", [
      { start: 0, end: 4 },
      { start: 1, end: 6 },
    ]) as unknown as React.ReactNode[];
    const marks = result.filter(isValidElement) as React.ReactElement<{
      children: string;
    }>[];
    expect(marks.map(m => m.props.children)).toEqual(["abcd", "ef"]);
  });

  it("applies a custom color, falling back to a default when none is given", () => {
    const [withColor] = renderTextWithHighlights("x", [
      { start: 0, end: 1, color: "#123456" },
    ]) as unknown as React.ReactElement<{
      style: { backgroundColor: string };
    }>[];
    expect(withColor.props.style.backgroundColor).toBe("#123456");

    const [withoutColor] = renderTextWithHighlights("x", [
      { start: 0, end: 1 },
    ]) as unknown as React.ReactElement<{
      style: { backgroundColor: string };
    }>[];
    expect(withoutColor.props.style.backgroundColor).toBe("#ffe08a");
  });
});
