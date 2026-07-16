import { describe, it, expect } from "vitest";
import { findCrossings } from "./alerts";

const egg = (id: number, priceAtFlag: number | null, currentPrice: number | null) =>
  ({ id, priceAtFlag, currentPrice }) as any;

describe("findCrossings", () => {
  it("flags a gain at or above the threshold", () => {
    const out = findCrossings([egg(1, 100, 110)], 10);
    expect(out).toEqual([{ eggId: 1, direction: "gain", returnPct: expect.closeTo(10), price: 110 }]);
  });

  it("flags a loss at or beyond the negative threshold", () => {
    const out = findCrossings([egg(1, 100, 85)], 10);
    expect(out[0].direction).toBe("loss");
    expect(out[0].returnPct).toBeCloseTo(-15);
  });

  it("ignores moves inside the threshold band", () => {
    expect(findCrossings([egg(1, 100, 105)], 10)).toEqual([]);
    expect(findCrossings([egg(1, 100, 95)], 10)).toEqual([]);
  });

  it("treats the threshold as inclusive", () => {
    expect(findCrossings([egg(1, 100, 110)], 10)).toHaveLength(1);
    expect(findCrossings([egg(1, 100, 90)], 10)).toHaveLength(1);
  });

  it("skips eggs with no flag or current price", () => {
    expect(findCrossings([egg(1, null, 110), egg(2, 100, null)], 10)).toEqual([]);
  });

  it("skips a zero/negative flag price rather than dividing by it", () => {
    expect(findCrossings([egg(1, 0, 110)], 10)).toEqual([]);
    expect(findCrossings([egg(1, -5, 110)], 10)).toEqual([]);
  });

  it("ignores the known corrupt flag prices instead of alerting on a fake +107,000%", () => {
    // GEV in the real snapshot: $1 placeholder against a $1,072 stock.
    expect(findCrossings([egg(1, 1, 1071.99)], 10)).toEqual([]);
  });

  it("evaluates each egg independently", () => {
    const out = findCrossings([egg(1, 100, 120), egg(2, 100, 101), egg(3, 100, 80)], 10);
    expect(out.map((c) => [c.eggId, c.direction])).toEqual([
      [1, "gain"],
      [3, "loss"],
    ]);
  });

  it("respects a custom threshold", () => {
    expect(findCrossings([egg(1, 100, 110)], 25)).toEqual([]);
    expect(findCrossings([egg(1, 100, 130)], 25)).toHaveLength(1);
  });

  it("returns nothing for an empty watchlist", () => {
    expect(findCrossings([], 10)).toEqual([]);
  });
});
