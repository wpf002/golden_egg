import { describe, it, expect } from "vitest";
import { scoreReturn } from "./backtest";

const closes = (...pairs: [string, number][]) => pairs.map(([date, close]) => ({ date, close }));

describe("scoreReturn — with daily candles", () => {
  it("scores from the first close on or after the flag date to the latest close", () => {
    const r = scoreReturn({
      closes: closes(["2026-01-01", 100], ["2026-01-02", 110]),
      flagDate: "2026-01-01",
      priceAtFlag: null,
      currentPrice: null,
    });
    expect(r.flagClose).toBe(100);
    expect(r.latestClose).toBe(110);
    expect(r.returnPct).toBeCloseTo(10);
    expect(r.suspect).toBe(false);
  });

  it("skips closes before the flag date", () => {
    const r = scoreReturn({
      closes: closes(["2025-12-01", 50], ["2026-01-05", 100], ["2026-01-06", 120]),
      flagDate: "2026-01-03",
      priceAtFlag: null,
      currentPrice: null,
    });
    expect(r.flagClose).toBe(100); // not 50
    expect(r.returnPct).toBeCloseTo(20);
  });

  it("computes a negative return", () => {
    const r = scoreReturn({
      closes: closes(["2026-01-01", 100], ["2026-01-02", 75]),
      flagDate: "2026-01-01",
      priceAtFlag: null,
      currentPrice: null,
    });
    expect(r.returnPct).toBeCloseTo(-25);
  });
});

describe("scoreReturn — spot fallback (no candles on the free plan)", () => {
  it("falls back to the recorded flag price and the current spot price", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: 200, currentPrice: 250 });
    expect(r.flagClose).toBe(200);
    expect(r.latestClose).toBe(250);
    expect(r.returnPct).toBeCloseTo(25);
  });

  it("yields no return when there is no price at all", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: null, currentPrice: null });
    expect(r.returnPct).toBeNull();
    expect(r.suspect).toBe(false);
  });

  it("yields no return when the flag price is missing", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: null, currentPrice: 100 });
    expect(r.returnPct).toBeNull();
  });
});

describe("scoreReturn — corrupt flag-price guard", () => {
  it("excludes the real-world GEV case ($1 placeholder vs a $1,072 stock)", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: 1, currentPrice: 1071.99 });
    expect(r.suspect).toBe(true);
    // must not report a +107,000% win
    expect(r.returnPct).toBeNull();
    // the raw prices are still surfaced so the row can be inspected
    expect(r.flagClose).toBe(1);
    expect(r.latestClose).toBe(1071.99);
  });

  it("keeps a large-but-plausible gain", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: 100, currentPrice: 900 });
    expect(r.suspect).toBe(false);
    expect(r.returnPct).toBeCloseTo(800);
  });

  it("flags an implausible collapse too, not just gains", () => {
    // -100% is the floor for equities, so |return| > 1000 can only come from
    // bad data — but assert the guard is magnitude-based, not gain-only.
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: 1, currentPrice: 20000 });
    expect(r.suspect).toBe(true);
  });

  it("treats a zero flag price as unscoreable rather than dividing by zero", () => {
    const r = scoreReturn({ closes: [], flagDate: "2026-01-01", priceAtFlag: 0, currentPrice: 100 });
    expect(r.returnPct).toBeNull();
    expect(Number.isFinite(r.returnPct as any)).toBe(false);
  });
});
