import { describe, it, expect } from "vitest";
import { applyGrounding, type GroundingVerdict } from "./grounding";

const egg = (ticker: string) =>
  ({
    ticker,
    company_name: ticker,
    thesis: "t",
    hop_distance: 2,
    confidence: 0.8,
    novelty_score: 0.7,
    timing_lag: "concurrent",
    sector: "Industrials",
    ripple_path: [],
  }) as any;

describe("applyGrounding", () => {
  it("drops refuted eggs and marks supported ones verified", () => {
    const verdicts: GroundingVerdict[] = [
      { ticker: "AAA", verdict: "supported" },
      { ticker: "BBB", verdict: "refuted", note: "acquired" },
      { ticker: "CCC", verdict: "unclear" },
    ];
    const { kept, refuted } = applyGrounding([egg("AAA"), egg("BBB"), egg("CCC")], verdicts);
    expect(refuted.map((e) => e.ticker)).toEqual(["BBB"]);
    expect(kept.find((e) => e.ticker === "AAA")?.verified).toBe(true);
    // Unclear is NOT verified — absence of confirmation is not confirmation.
    expect(kept.find((e) => e.ticker === "CCC")?.verified).toBeUndefined();
  });

  it("keeps eggs with no verdict at all, unverified", () => {
    const { kept, refuted } = applyGrounding([egg("AAA")], []);
    expect(kept).toHaveLength(1);
    expect(kept[0].verified).toBeUndefined();
    expect(refuted).toHaveLength(0);
  });

  it("matches tickers case-insensitively", () => {
    const { refuted } = applyGrounding([egg("aaa")], [{ ticker: "AAA", verdict: "refuted" }]);
    expect(refuted).toHaveLength(1);
  });
});
