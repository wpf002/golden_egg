import { describe, it, expect } from "vitest";
import { toYmd } from "./finance";

describe("toYmd", () => {
  it("formats a unix ms timestamp as YYYY-MM-DD (UTC)", () => {
    expect(toYmd(Date.UTC(2026, 6, 9))).toBe("2026-07-09");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toYmd(Date.UTC(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses UTC, not local time, so backtest date ranges are stable across machines", () => {
    // 23:30 UTC on Jan 1 must stay Jan 1 even west of Greenwich.
    expect(toYmd(Date.UTC(2026, 0, 1, 23, 30))).toBe("2026-01-01");
  });
});
