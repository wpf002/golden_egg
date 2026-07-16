import { describe, it, expect } from "vitest";
import { returnVsFlag, deltaColor } from "./returns";

describe("returnVsFlag", () => {
  it("computes a gain", () => {
    expect(returnVsFlag(100, 110).pct).toBeCloseTo(10);
  });

  it("computes a loss", () => {
    expect(returnVsFlag(100, 75).pct).toBeCloseTo(-25);
  });

  it("suppresses the real-world GEV case rather than rendering +102,806%", () => {
    const r = returnVsFlag(1, 1029.06);
    expect(r.pct).toBeNull();
    expect(r.suspect).toBe(true);
  });

  it("keeps a large-but-plausible gain", () => {
    const r = returnVsFlag(100, 900);
    expect(r.pct).toBeCloseTo(800);
    expect(r.suspect).toBe(false);
  });

  it("returns null (not suspect) when prices are missing", () => {
    expect(returnVsFlag(null, 100)).toEqual({ pct: null, suspect: false });
    expect(returnVsFlag(100, null)).toEqual({ pct: null, suspect: false });
    expect(returnVsFlag(null, null)).toEqual({ pct: null, suspect: false });
  });

  it("refuses to divide by a zero/negative flag price", () => {
    expect(returnVsFlag(0, 100)).toEqual({ pct: null, suspect: false });
    expect(returnVsFlag(-1, 100)).toEqual({ pct: null, suspect: false });
  });

  it("treats a flat price as 0%, not null", () => {
    expect(returnVsFlag(50, 50).pct).toBe(0);
  });
});

describe("deltaColor", () => {
  it("uses emerald for gains, rose for losses, muted otherwise", () => {
    expect(deltaColor(5)).toContain("emerald");
    expect(deltaColor(-5)).toContain("rose");
    expect(deltaColor(0)).toContain("muted");
    expect(deltaColor(null)).toContain("muted");
  });
});
