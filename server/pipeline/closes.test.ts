import { describe, it, expect } from "vitest";
import { ymd, isWeekend, candidateDays } from "./closes";

describe("ymd", () => {
  it("formats UTC, so cached dates don't shift by timezone", () => {
    expect(ymd(Date.UTC(2026, 6, 16, 23, 30))).toBe("2026-07-16");
  });
});

describe("isWeekend", () => {
  it("identifies Saturday and Sunday", () => {
    expect(isWeekend("2026-07-18")).toBe(true); // Sat
    expect(isWeekend("2026-07-19")).toBe(true); // Sun
  });

  it("identifies weekdays", () => {
    expect(isWeekend("2026-07-16")).toBe(false); // Thu
    expect(isWeekend("2026-07-17")).toBe(false); // Fri
    expect(isWeekend("2026-07-20")).toBe(false); // Mon
  });
});

describe("candidateDays", () => {
  const THU = Date.UTC(2026, 6, 16); // Thursday

  it("returns newest first", () => {
    const days = candidateDays(THU, 3);
    expect(days[0]).toBe("2026-07-16");
    expect(days[1]).toBe("2026-07-15");
  });

  it("drops weekends rather than spending a request to discover they're empty", () => {
    // 7 calendar days back from Thu 16th spans Sat 11th and Sun 12th.
    const days = candidateDays(THU, 7);
    expect(days).not.toContain("2026-07-11");
    expect(days).not.toContain("2026-07-12");
    expect(days).toHaveLength(5);
  });

  it("returns nothing for a zero window", () => {
    expect(candidateDays(THU, 0)).toEqual([]);
  });

  it("a full week yields exactly the 5 weekdays", () => {
    const days = candidateDays(Date.UTC(2026, 6, 17), 7); // Fri
    expect(days).toHaveLength(5);
    expect(days.every((d) => !isWeekend(d))).toBe(true);
  });
});
