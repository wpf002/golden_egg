import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20, 5], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20, 5]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return i;
      }
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("processes every item", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 7, async (i) => i * 2);
    expect(out).toEqual(items.map((i) => i * 2));
  });

  it("returns empty for an empty list without invoking the mapper", async () => {
    let called = false;
    const out = await mapWithConcurrency([], 5, async (x) => {
      called = true;
      return x;
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it("handles a limit larger than the item count", async () => {
    const out = await mapWithConcurrency([1, 2], 99, async (x) => x + 1);
    expect(out).toEqual([2, 3]);
  });

  it("propagates a mapper rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      })
    ).rejects.toThrow("boom");
  });
});
