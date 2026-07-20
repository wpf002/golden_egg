import { describe, it, expect } from "vitest";
import { eggScore } from "./scoring";

const egg = (over: Partial<Parameters<typeof eggScore>[0]> = {}) => ({
  confidence: 0.8,
  noveltyScore: 0.5,
  hopDistance: 2,
  ...over,
});

describe("eggScore — ships, not the tide", () => {
  it("ranks a hop-2 pick above an identical hop-1 pick", () => {
    expect(eggScore(egg({ hopDistance: 2 }))).toBeGreaterThan(eggScore(egg({ hopDistance: 1 })));
  });

  it("gives hop-3 the biggest boost", () => {
    expect(eggScore(egg({ hopDistance: 3 }))).toBeGreaterThan(eggScore(egg({ hopDistance: 2 })));
  });

  it("prefers calibrated confidence when the server provides it", () => {
    // A losing theme's calibration drags the score down past the model's grade.
    const raw = eggScore(egg({ confidence: 0.9 }));
    const calibrated = eggScore(egg({ confidence: 0.9, calibratedConfidence: 0.4 }));
    expect(calibrated).toBeLessThan(raw);
  });

  it("novelty raises the score", () => {
    expect(eggScore(egg({ noveltyScore: 0.9 }))).toBeGreaterThan(eggScore(egg({ noveltyScore: 0.2 })));
  });

  it("an unknown hop gets no weight adjustment", () => {
    expect(eggScore(egg({ hopDistance: 7 }))).toBeCloseTo(0.8 * 1.5);
  });
});
