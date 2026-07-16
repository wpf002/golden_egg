import { describe, it, expect } from "vitest";
import { daysBetween, daysToFirstMove, analyzeHopLag, type EggSeries } from "./hop-lag";

const closes = (...pairs: [string, number][]) => pairs.map(([date, close]) => ({ date, close }));

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-04")).toBe(3);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("returns 0 for unparseable input rather than NaN", () => {
    expect(daysBetween("nope", "2026-01-01")).toBe(0);
  });
});

describe("daysToFirstMove", () => {
  it("returns days until the price first crosses the threshold", () => {
    const c = closes(["2026-01-01", 100], ["2026-01-02", 101], ["2026-01-04", 105]);
    expect(daysToFirstMove(c, "2026-01-01", 3)).toBe(3); // +5% on Jan 4
  });

  it("counts a DOWN move too — we're timing the reaction, not the direction", () => {
    const c = closes(["2026-01-01", 100], ["2026-01-03", 90]);
    expect(daysToFirstMove(c, "2026-01-01", 3)).toBe(2);
  });

  it("returns null when it never moves enough (rather than inventing a big lag)", () => {
    const c = closes(["2026-01-01", 100], ["2026-01-02", 101], ["2026-01-03", 100.5]);
    expect(daysToFirstMove(c, "2026-01-01", 3)).toBeNull();
  });

  it("ignores closes before the flag date", () => {
    const c = closes(["2025-12-01", 50], ["2026-01-01", 100], ["2026-01-02", 110]);
    expect(daysToFirstMove(c, "2026-01-01", 3)).toBe(1); // baseline is 100, not 50
  });

  it("needs at least two points", () => {
    expect(daysToFirstMove(closes(["2026-01-01", 100]), "2026-01-01", 3)).toBeNull();
    expect(daysToFirstMove([], "2026-01-01", 3)).toBeNull();
  });

  it("refuses a zero baseline instead of dividing by it", () => {
    expect(daysToFirstMove(closes(["2026-01-01", 0], ["2026-01-02", 10]), "2026-01-01", 3)).toBeNull();
  });
});

function egg(id: number, hop: number, series: [string, number][]): EggSeries {
  return { eggId: id, ticker: `T${id}`, hopDistance: hop, flagDate: "2026-01-01", closes: closes(...series) };
}

describe("analyzeHopLag", () => {
  it("detects 2nd-order lagging 1st-order (the thesis holding)", () => {
    const hop1 = [1, 2, 3].map((i) =>
      egg(i, 1, [
        ["2026-01-01", 100],
        ["2026-01-02", 110],
      ])
    ); // 1 day
    const hop2 = [4, 5, 6].map(
      (i) =>
        egg(i, 2, [
          ["2026-01-01", 100],
          ["2026-01-02", 100.5],
          ["2026-01-06", 110],
        ]) // 5 days
    );
    const r = analyzeHopLag([...hop1, ...hop2], 3);
    expect(r.hop1ToHop2LagDays).toBe(4);
    expect(r.verdict).toMatch(/consistent with the parallel-markets thesis/);
  });

  it("reports the thesis FAILING when 2nd-order moves first", () => {
    const hop1 = [1, 2, 3].map((i) =>
      egg(i, 1, [
        ["2026-01-01", 100],
        ["2026-01-05", 110],
      ])
    ); // 4 days
    const hop2 = [4, 5, 6].map((i) =>
      egg(i, 2, [
        ["2026-01-01", 100],
        ["2026-01-02", 110],
      ])
    ); // 1 day
    const r = analyzeHopLag([...hop1, ...hop2], 3);
    expect(r.hop1ToHop2LagDays).toBe(-3);
    expect(r.verdict).toMatch(/opposite of the thesis/);
  });

  it("says 'no timing edge' when both hops move together", () => {
    const hop1 = [1, 2, 3].map((i) =>
      egg(i, 1, [
        ["2026-01-01", 100],
        ["2026-01-03", 110],
      ])
    );
    const hop2 = [4, 5, 6].map((i) =>
      egg(i, 2, [
        ["2026-01-01", 100],
        ["2026-01-03", 110],
      ])
    );
    const r = analyzeHopLag([...hop1, ...hop2], 3);
    expect(r.hop1ToHop2LagDays).toBe(0);
    expect(r.verdict).toMatch(/no timing edge/);
  });

  it("REFUSES to draw a conclusion from a tiny sample", () => {
    // One egg per hop would produce a confident-looking number from noise.
    const r = analyzeHopLag(
      [
        egg(1, 1, [
          ["2026-01-01", 100],
          ["2026-01-02", 110],
        ]),
        egg(2, 2, [
          ["2026-01-01", 100],
          ["2026-01-09", 110],
        ]),
      ],
      3
    );
    expect(r.hop1ToHop2LagDays).toBeNull();
    expect(r.verdict).toMatch(/Not enough data/);
  });

  it("counts eggs that never moved separately instead of dropping them", () => {
    const movers = [1, 2, 3].map((i) =>
      egg(i, 1, [
        ["2026-01-01", 100],
        ["2026-01-02", 110],
      ])
    );
    const flat = egg(9, 1, [
      ["2026-01-01", 100],
      ["2026-01-02", 100.1],
    ]);
    const r = analyzeHopLag([...movers, flat], 3);
    const h1 = r.byHop.find((h) => h.hopDistance === 1)!;
    expect(h1.moved).toBe(3);
    expect(h1.neverMoved).toBe(1);
  });

  it("handles an empty input", () => {
    const r = analyzeHopLag([], 3);
    expect(r.byHop).toEqual([]);
    expect(r.verdict).toMatch(/Not enough data/);
  });
});
