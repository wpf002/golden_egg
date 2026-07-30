import { describe, it, expect } from "vitest";
import { growthAdjusted, compareValuation, sizeRatio, describeComparison } from "./valuation";

const f = (o: Partial<Parameters<typeof compareValuation>[0]>) => ({
  ticker: "X",
  marketCapM: null,
  priceToSales: null,
  peRatio: null,
  revenueGrowthPct: null,
  grossMarginPct: null,
  ...o,
});

describe("growthAdjusted", () => {
  it("prices sales multiple per point of growth", () => {
    expect(growthAdjusted({ priceToSales: 20, revenueGrowthPct: 100 })).toBeCloseTo(0.2);
  });

  it("returns null when a shrinking or zero-growth company can't be ranked", () => {
    expect(growthAdjusted({ priceToSales: 20, revenueGrowthPct: 0 })).toBeNull();
    expect(growthAdjusted({ priceToSales: 20, revenueGrowthPct: -15 })).toBeNull();
    expect(growthAdjusted({ priceToSales: 0, revenueGrowthPct: 50 })).toBeNull();
    expect(growthAdjusted({ priceToSales: null, revenueGrowthPct: 50 })).toBeNull();
  });
});

describe("compareValuation", () => {
  // The real numbers that motivated this module: Credo looks expensive on
  // sales alone (24.8x vs 18.4x) but is far cheaper per point of growth.
  const credo = f({ priceToSales: 24.78, revenueGrowthPct: 157.02, marketCapM: 33090 });
  const nvda = f({ priceToSales: 18.37, revenueGrowthPct: 85.23, marketCapM: 4656564 });

  it("calls the higher-multiple, faster-growing name the cheaper one", () => {
    const cmp = compareValuation(credo, nvda);
    expect(cmp.verdict).toBe("cheaper-for-the-growth");
    expect(cmp.premiumPct!).toBeLessThan(0);
  });

  it("flags a name whose story is already priced in", () => {
    const astera = f({ priceToSales: 42.75, revenueGrowthPct: 93.4 });
    expect(compareValuation(astera, nvda).verdict).toBe("richer-for-the-growth");
  });

  it("treats small differences as comparable rather than a signal", () => {
    const near = f({ priceToSales: 19, revenueGrowthPct: 85 });
    expect(compareValuation(near, nvda).verdict).toBe("comparable");
  });

  it("reports unknown when either side lacks figures", () => {
    expect(compareValuation(f({ priceToSales: 10 }), nvda).verdict).toBe("unknown");
    expect(compareValuation(credo, f({})).verdict).toBe("unknown");
  });
});

describe("sizeRatio", () => {
  it("expresses how many times bigger the anchor is", () => {
    expect(sizeRatio(f({ marketCapM: 1000 }), f({ marketCapM: 100000 }))).toBe(100);
  });
  it("is null without both caps", () => {
    expect(sizeRatio(f({ marketCapM: null }), f({ marketCapM: 100 }))).toBeNull();
    expect(sizeRatio(f({ marketCapM: 0 }), f({ marketCapM: 100 }))).toBeNull();
  });
});

describe("describeComparison", () => {
  it("states the direction in plain words", () => {
    const cmp = compareValuation(
      f({ priceToSales: 10, revenueGrowthPct: 200 }),
      f({ priceToSales: 20, revenueGrowthPct: 100 })
    );
    const s = describeComparison("AAA", "BBB", cmp, 50);
    expect(s).toContain("50x smaller");
    expect(s).toMatch(/more growth per unit of price/);
  });

  it("says so when it can't price the pair", () => {
    const cmp = compareValuation(f({}), f({}));
    expect(describeComparison("AAA", "BBB", cmp, null)).toMatch(/Not enough reported figures/);
  });
});
