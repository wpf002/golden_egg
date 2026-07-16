import { describe, it, expect } from "vitest";
import { renderMarkdownReport } from "./report";
import type { GoldenEggWithCatalyst } from "@shared/schema";

const NOW = Date.UTC(2026, 6, 16);

function egg(over: Partial<GoldenEggWithCatalyst> = {}): GoldenEggWithCatalyst {
  return {
    id: 1,
    catalystId: 1,
    ticker: "AAA",
    companyName: "Alpha Corp",
    thesis: "Alpha supplies the picks.",
    hopDistance: 2,
    confidence: 0.8,
    noveltyScore: 0.7,
    timingLag: "concurrent",
    sector: "Industrials",
    sectorDetail: "Industrials / Cash Logistics",
    ripplePath: JSON.stringify([{ node: "Catalyst" }, { node: "Alpha Corp" }]),
    priceAtFlag: 100,
    priceAtFlagDate: NOW - 86_400_000,
    currentPrice: 110,
    priceRefreshedAt: NOW,
    createdAt: NOW - 86_400_000,
    catalyst: { id: 1, title: "Big shift", theme: "Quantum computing", sourceUrl: "https://ex.com" },
    ...over,
  } as GoldenEggWithCatalyst;
}

describe("renderMarkdownReport", () => {
  it("renders a table row and a thesis section", () => {
    const md = renderMarkdownReport([egg()], { topN: 10, now: NOW });
    expect(md).toContain("# Golden Egg — top parallel plays");
    expect(md).toContain("**AAA**");
    expect(md).toContain("Alpha supplies the picks.");
    expect(md).toContain("+10.0%");
  });

  it("ranks by confidence x novelty, not by confidence alone", () => {
    // B has lower confidence but much higher novelty => higher score.
    const a = egg({ id: 1, ticker: "AAA", confidence: 0.9, noveltyScore: 0.1 }); // 0.99
    const b = egg({ id: 2, ticker: "BBB", confidence: 0.8, noveltyScore: 0.9 }); // 1.52
    const md = renderMarkdownReport([a, b], { topN: 10, now: NOW });
    expect(md.indexOf("**BBB**")).toBeLessThan(md.indexOf("**AAA**"));
  });

  it("honours topN", () => {
    const eggs = [1, 2, 3].map((i) => egg({ id: i, ticker: `T${i}` }));
    const md = renderMarkdownReport(eggs, { topN: 2, now: NOW });
    expect(md).toContain("2 of 3 eggs");
  });

  it("filters by sinceDays on the flag date", () => {
    const fresh = egg({ id: 1, ticker: "NEW", priceAtFlagDate: NOW - 2 * 86_400_000 });
    const old = egg({ id: 2, ticker: "OLD", priceAtFlagDate: NOW - 60 * 86_400_000 });
    const md = renderMarkdownReport([fresh, old], { topN: 10, sinceDays: 7, now: NOW });
    expect(md).toContain("**NEW**");
    expect(md).not.toContain("**OLD**");
    expect(md).toContain("last 7 days");
  });

  it("withholds a corrupt-flag-price return instead of printing +102806%", () => {
    const md = renderMarkdownReport([egg({ priceAtFlag: 1, currentPrice: 1029.06 })], {
      topN: 10,
      now: NOW,
    });
    expect(md).toContain("n/a*");
    expect(md).toContain("looks corrupt");
    expect(md).not.toMatch(/\+10\d{4}/);
  });

  it("handles an empty set without emitting a broken table", () => {
    const md = renderMarkdownReport([], { topN: 10, now: NOW });
    expect(md).toContain("No eggs match");
    expect(md).not.toContain("| # |");
  });

  it("prefers sectorDetail over the canonical bucket in the thesis block", () => {
    const md = renderMarkdownReport([egg()], { topN: 10, now: NOW });
    expect(md).toContain("Industrials / Cash Logistics");
  });

  it("survives an unparseable ripple path", () => {
    const md = renderMarkdownReport([egg({ ripplePath: "not json" })], { topN: 10, now: NOW });
    expect(md).toContain("**AAA**");
    expect(md).not.toContain("**Ripple:**");
  });

  it("renders an em dash when prices are missing", () => {
    const md = renderMarkdownReport([egg({ priceAtFlag: null, currentPrice: null })], {
      topN: 10,
      now: NOW,
    });
    expect(md).toContain("| — | — | — |");
  });
});
