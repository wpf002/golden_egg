import { describe, it, expect } from "vitest";
import { computeCalibration, calibrate } from "./calibration";

const row = (theme: string, confidence: number, returnPct: number | null) => ({
  theme,
  confidence,
  returnPct,
});

describe("computeCalibration", () => {
  it("computes per-theme win rate from scored picks only", () => {
    const cal = computeCalibration([
      row("A", 0.8, 5),
      row("A", 0.7, -2),
      row("A", 0.9, null), // unscoreable — excluded
    ]);
    const a = cal.get("A")!;
    expect(a.n).toBe(2);
    expect(a.winRate).toBeCloseTo(0.5);
    expect(a.avgModelConfidence).toBeCloseTo(0.75);
  });

  it("returns nothing for themes with no scored picks", () => {
    expect(computeCalibration([row("A", 0.8, null)]).size).toBe(0);
  });
});

describe("calibrate", () => {
  it("passes model confidence through untouched with no track record", () => {
    expect(calibrate(0.85, undefined)).toBe(0.85);
  });

  it("barely moves on a thin sample", () => {
    const cal = computeCalibration([row("A", 0.8, 5)]).get("A"); // n=1, winRate=1
    // w = 10/11 → mostly the model, slightly pulled toward 1.0
    expect(calibrate(0.8, cal)).toBeGreaterThan(0.8);
    expect(calibrate(0.8, cal)).toBeLessThan(0.83);
  });

  it("REGRESSION: heavily discounts a confident model on a losing theme", () => {
    // 30 scored picks, 20% win rate — a theme the model keeps overrating.
    const rows = Array.from({ length: 30 }, (_, i) => row("A", 0.9, i < 6 ? 5 : -5));
    const cal = computeCalibration(rows).get("A");
    const adjusted = calibrate(0.9, cal);
    // w = 10/40 = 0.25 → 0.25·0.9 + 0.75·0.2 = 0.375
    expect(adjusted).toBeCloseTo(0.375);
    // The whole point: results outweigh self-assessment once evidence piles up.
    expect(adjusted).toBeLessThan(0.5);
  });

  it("boosts an underconfident model on a winning theme", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row("A", 0.5, i < 27 ? 5 : -5)); // 90% wins
    const adjusted = calibrate(0.5, computeCalibration(rows).get("A"));
    expect(adjusted).toBeGreaterThan(0.7);
  });

  it("approaches the win rate as evidence grows without bound", () => {
    const rows = Array.from({ length: 500 }, () => row("A", 0.9, 5)); // 100% wins
    expect(calibrate(0.2, computeCalibration(rows).get("A"))).toBeGreaterThan(0.95);
  });
});
