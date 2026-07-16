import { describe, it, expect } from "vitest";
import { coerceToCanonical, extractJson, coerceToSector, themeFromId } from "./ripple-utils";
import { CANONICAL_THEMES, CANONICAL_SECTORS } from "@shared/schema";

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

  it("REGRESSION: returns '' rather than passing an unknown theme through", () => {
    // This used to `return raw.slice(0, 60)`, so every invented theme became its
    // own cache key. The cache hit 0 times in 6 scans while 229 credits burned.
    expect(coerceToCanonical("underwater basket weaving")).toBe("");
    expect(coerceToCanonical("z".repeat(100))).toBe("");
  });

  it("REGRESSION: rejects the real themes that fragmented the cache", () => {
    // Straight from ripple_cache — 9 entries, 9 non-canonical, 0 hits.
    for (const invented of [
      "geopolitical energy supply volatility",
      "bank capital adequacy requirements",
      "anti-money laundering regulatory compliance",
    ]) {
      expect(coerceToCanonical(invented)).toBe("");
    }
  });

  it("does NOT fuzzy-match on generic shared tokens", () => {
    // Token-overlap scoring mapped this onto "Semiconductor supply chain",
    // which would serve semiconductor eggs for an energy catalyst. A miss is
    // safer than a confident wrong answer.
    expect(coerceToCanonical("global energy supply chain disruption")).not.toBe("Semiconductor supply chain");
  });

  it("handles empty/whitespace input without throwing", () => {
    expect(coerceToCanonical("")).toBe("");
    expect(coerceToCanonical("   ")).toBe("");
  });

  it("every canonical theme round-trips to itself (cache-key stability)", () => {
    // This is the credit-saving invariant: identical strings => cache hits.
    for (const theme of CANONICAL_THEMES) {
      expect(coerceToCanonical(theme)).toBe(theme);
    }
  });
});

describe("themeFromId", () => {
  it("resolves a 1-based index to its canonical theme", () => {
    expect(themeFromId(1)).toBe(CANONICAL_THEMES[0]);
    expect(themeFromId(CANONICAL_THEMES.length)).toBe(CANONICAL_THEMES[CANONICAL_THEMES.length - 1]);
  });

  it("accepts a numeric string (models emit both)", () => {
    expect(themeFromId("2")).toBe(CANONICAL_THEMES[1]);
  });

  it("rejects out-of-range, zero, and junk rather than guessing", () => {
    // 0 is the documented 'nothing fits' signal.
    expect(themeFromId(0)).toBe("");
    expect(themeFromId(-1)).toBe("");
    expect(themeFromId(CANONICAL_THEMES.length + 1)).toBe("");
    expect(themeFromId(1.5)).toBe("");
    expect(themeFromId("banana")).toBe("");
    expect(themeFromId(null)).toBe("");
    expect(themeFromId(undefined)).toBe("");
  });

  it("every id round-trips to a canonical theme", () => {
    for (let i = 1; i <= CANONICAL_THEMES.length; i++) {
      expect(CANONICAL_THEMES).toContain(themeFromId(i) as any);
    }
  });
});

describe("CANONICAL_THEMES coverage", () => {
  it("covers the catalyst classes the ingest feeds actually produce", () => {
    // Added after finding the cache had never hit: the feeds emit classes the
    // original 16 couldn't hold, so the classifier invented themes forever.
    const joined = CANONICAL_THEMES.join(" | ").toLowerCase();
    for (const needed of [
      "energy supply",
      "monetary policy",
      "financial regulation",
      "trade policy",
      "labor market",
    ]) {
      expect(joined).toContain(needed);
    }
  });
});

describe("coerceToSector", () => {
  it("passes through an exact canonical sector", () => {
    expect(coerceToSector("Industrials")).toBe("Industrials");
    expect(coerceToSector("Real Estate")).toBe("Real Estate");
  });

  it("takes the root before the slash", () => {
    expect(coerceToSector("Technology / FinTech Compliance")).toBe("Technology");
    expect(coerceToSector("Industrials / Cash Logistics")).toBe("Industrials");
    expect(coerceToSector("Financials / Mortgage REIT")).toBe("Financials");
  });

  it("prefers the longest alias so 'energy midstream' doesn't just match 'energy'", () => {
    // Both resolve to Energy here, but the ordering rule matters for future aliases.
    expect(coerceToSector("Energy Midstream / MLP")).toBe("Energy");
    expect(coerceToSector("Energy")).toBe("Energy");
  });

  it("maps the real non-GICS roots this dataset actually contains", () => {
    expect(coerceToSector("Oilfield Services")).toBe("Energy");
    expect(coerceToSector("Oilfield Services / Specialty Chemicals")).toBe("Energy");
    expect(coerceToSector("Energy Services")).toBe("Energy");
    expect(coerceToSector("Energy Technology")).toBe("Energy");
    expect(coerceToSector("Midstream Energy")).toBe("Energy");
    expect(coerceToSector("Midstream / MLP")).toBe("Energy");
    expect(coerceToSector("Marine Transportation")).toBe("Industrials");
    expect(coerceToSector("Financial Technology / RegTech")).toBe("Financials");
    expect(coerceToSector("Financial Data & Analytics")).toBe("Financials");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(coerceToSector("  industrials  ")).toBe("Industrials");
    expect(coerceToSector("TECHNOLOGY / Analytics")).toBe("Technology");
  });

  it("falls back to Other instead of minting a new bucket", () => {
    expect(coerceToSector("Underwater Basket Weaving")).toBe("Other");
    expect(coerceToSector("")).toBe("Other");
    expect(coerceToSector(null)).toBe("Other");
    expect(coerceToSector(undefined)).toBe("Other");
    expect(coerceToSector("   ")).toBe("Other");
  });

  it("always returns a member of CANONICAL_SECTORS (the rollup invariant)", () => {
    const realWorldInputs = [
      "Industrials",
      "Financials",
      "Utilities",
      "Technology / Financials",
      "Technology",
      "Oilfield Services",
      "Materials",
      "Healthcare",
      "Energy Services",
      "Energy / Shipping",
      "Energy",
      "Utilities / Nuclear",
      "Technology / HR Services",
      "Real Estate / Office REIT",
      "Midstream Energy",
      "Materials / Specialty Chemicals",
      "Marine Transportation",
      "Industrials / Engineering & Construction",
      "Financials / Non-bank Mortgage",
      "Financial Technology / Regulatory Infrastructure",
      "Financial Data & Analytics",
      "Energy Midstream / MLP",
      "Energy / LNG Infrastructure",
      "Energy / Coal",
      "Consumer Staples",
      "garbage",
    ];
    for (const input of realWorldInputs) {
      expect(CANONICAL_SECTORS).toContain(coerceToSector(input) as any);
    }
  });

  it("collapses this dataset's 46 sectors into a small bounded set", () => {
    const inputs = [
      "Industrials",
      "Technology / HR Services",
      "Technology / Government",
      "Oilfield Services",
      "Midstream Energy",
      "Energy / Coal",
      "Marine Transportation",
      "Financial Data & Analytics",
    ];
    const collapsed = new Set(inputs.map(coerceToSector));
    expect(collapsed.size).toBeLessThanOrEqual(4);
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
