import { describe, it, expect } from "vitest";
import { coerceToCanonical, extractJson } from "./ripple-utils";
import { CANONICAL_THEMES } from "@shared/schema";

describe("coerceToCanonical", () => {
  it("passes through an exact canonical theme unchanged", () => {
    expect(coerceToCanonical("AI datacenter buildout")).toBe("AI datacenter buildout");
    expect(coerceToCanonical("Quantum computing")).toBe("Quantum computing");
  });

  it("fuzzy-matches when all key tokens are present, regardless of case/extra words", () => {
    // "quantum" + "computing" both present -> canonical
    expect(coerceToCanonical("quantum computing breakthroughs")).toBe("Quantum computing");
    expect(coerceToCanonical("WATER INFRASTRUCTURE spending")).toBe("Water infrastructure");
  });

  it("ignores short tokens (<=3 chars) when matching", () => {
    // "AI datacenter buildout" -> tokens >3 chars are "datacenter","buildout" ("AI" dropped)
    expect(coerceToCanonical("global datacenter buildout wave")).toBe("AI datacenter buildout");
  });

  it("falls back to a truncated passthrough when nothing matches", () => {
    expect(coerceToCanonical("underwater basket weaving")).toBe("underwater basket weaving");
  });

  it("truncates the fallback to 60 chars to bound the cache key", () => {
    const long = "z".repeat(100);
    expect(coerceToCanonical(long)).toHaveLength(60);
  });

  it("handles empty input without throwing", () => {
    expect(coerceToCanonical("")).toBe("");
  });

  it("every canonical theme round-trips to itself (cache-key stability)", () => {
    // This is the credit-saving invariant: identical strings => cache hits.
    for (const theme of CANONICAL_THEMES) {
      expect(coerceToCanonical(theme)).toBe(theme);
    }
  });
});

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"eggs":[]}')).toEqual({ eggs: [] });
  });

  it("strips ```json fences (the common Claude/GPT wrapper)", () => {
    const fenced = '```json\n{"eggs":[{"ticker":"LMT"}]}\n```';
    expect(extractJson(fenced)).toEqual({ eggs: [{ ticker: "LMT" }] });
  });

  it("strips bare ``` fences", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers JSON from a prose preamble via the brace-span fallback", () => {
    const chatty = 'Sure! Here is the analysis you asked for:\n{"eggs":[{"ticker":"RTX"}]}\nHope that helps.';
    expect(extractJson(chatty)).toEqual({ eggs: [{ ticker: "RTX" }] });
  });

  it("returns null for empty or unparseable input rather than throwing", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("no json here at all")).toBeNull();
    expect(extractJson("{ definitely not json }")).toBeNull();
  });
});
