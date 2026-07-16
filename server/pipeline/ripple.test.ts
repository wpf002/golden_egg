import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Catalyst } from "@shared/schema";
import { CANONICAL_THEMES } from "@shared/schema";

// Mock the storage module so importing ripple.ts never opens data.db.
const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getCache: vi.fn(async () => undefined),
  putCache: vi.fn(async () => ({}) as any),
  createEgg: vi.fn(async () => ({}) as any),
  markCatalystAnalyzed: vi.fn(async () => {}),
  deleteCache: vi.fn(async () => {}),
  incrementCacheHit: vi.fn(async () => {}),
}));

vi.mock("../storage", () => ({
  storage: {
    listNodes: vi.fn(async () => []),
    listAllEdges: vi.fn(async () => []),
    getCache: mocks.getCache,
    putCache: mocks.putCache,
    createEgg: mocks.createEgg,
    markCatalystAnalyzed: mocks.markCatalystAnalyzed,
    deleteCache: mocks.deleteCache,
    incrementCacheHit: mocks.incrementCacheHit,
  },
}));

vi.mock("./providers/llm", () => ({ getLlm: () => ({ complete: mocks.complete }) }));
vi.mock("./finance", () => ({ fetchQuotes: vi.fn(async () => ({})) }));

const { processCatalysts } = await import("./ripple");

function catalyst(id: number, theme: string): Catalyst {
  return {
    id,
    contentHash: `h${id}`,
    title: `Catalyst ${id}`,
    summary: "summary",
    theme,
    canonicalTheme: null,
    sourceType: "rss",
    sourceUrl: null,
    strengthScore: 0.5,
    firstSeenAt: 0,
    lastSeenAt: 0,
    rippleAnalyzed: false,
    rippleCostCredits: 0,
  };
}

/** Classifier keeps everything, one distinct canonical theme per catalyst. */
function classifierResponse(ids: number[], themes: string[]) {
  return JSON.stringify({
    results: ids.map((id, i) => ({
      catalyst_id: id,
      keep: true,
      normalized_theme: themes[i],
      strength: 0.9,
      rationale: "test",
    })),
  });
}

/** Classifier responding with theme NUMBERS, which is what the prompt now asks for. */
function classifierIdResponse(pairs: Array<[id: number, themeId: number]>) {
  return JSON.stringify({
    results: pairs.map(([catalyst_id, theme_id]) => ({
      catalyst_id,
      keep: true,
      theme_id,
      strength: 0.9,
      rationale: "test",
    })),
  });
}

const ONE_EGG = JSON.stringify({
  eggs: [
    {
      ticker: "TST",
      company_name: "Test Co",
      thesis: "t",
      hop_distance: 2,
      confidence: 0.8,
      novelty_score: 0.7,
      timing_lag: "concurrent",
      sector: "Industrials",
      ripple_path: [],
    },
  ],
});

describe("processCatalysts — credit ceiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCache.mockResolvedValue(undefined); // always a cache miss => premium call
  });

  it("stops analyzing once the next premium call would exceed maxCredits", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1, 2], ["Quantum computing", "Space economy"]) : ONE_EGG
    );

    // classify costs ceil(2*0.5)=1; each premium call costs 15.
    // Budget 20 => first theme fits (1+15=16), second would hit 31 => stop.
    const stats = await processCatalysts([catalyst(1, "a"), catalyst(2, "b")], 20);

    expect(stats.themesAnalyzed).toBe(1);
    expect(stats.budgetExhausted).toBe(true);
    expect(stats.approxCredits).toBeLessThanOrEqual(20);
  });

  it("analyzes every theme when the budget is ample", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1, 2], ["Quantum computing", "Space economy"]) : ONE_EGG
    );

    const stats = await processCatalysts([catalyst(1, "a"), catalyst(2, "b")], 1000);

    expect(stats.themesAnalyzed).toBe(2);
    expect(stats.budgetExhausted).toBe(false);
  });

  it("defaults to no ceiling when maxCredits is omitted", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1], ["Quantum computing"]) : ONE_EGG
    );
    const stats = await processCatalysts([catalyst(1, "a")]);
    expect(stats.budgetExhausted).toBe(false);
    expect(stats.themesAnalyzed).toBe(1);
  });

  it("returns zeroed stats for an empty batch without calling the LLM", async () => {
    const stats = await processCatalysts([], 100);
    expect(stats.approxCredits).toBe(0);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

describe("processCatalysts — canonical themes (the cache-hit invariant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCache.mockResolvedValue(undefined);
  });

  it("accepts a theme_id and caches under the canonical name", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierIdResponse([[1, 1]]) : ONE_EGG
    );
    await processCatalysts([catalyst(1, "energy data")], 100);
    expect(mocks.putCache).toHaveBeenCalledTimes(1);
    // Cached under CANONICAL_THEMES[0], never the feed's own label.
    const cached = mocks.putCache.mock.calls[0][0] as any;
    expect(cached.themeSummary).toBe(CANONICAL_THEMES[0]);
    expect(cached.themeSummary).not.toBe("energy data");
  });

  it("REGRESSION: two catalysts on the same theme share ONE premium call", async () => {
    // The whole point of canonicalization. Before the fix the classifier
    // invented a distinct theme per catalyst, so keys never collided, the cache
    // hit 0 times in 6 scans, and every catalyst paid for its own analysis.
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap"
        ? classifierIdResponse([
            [1, 3],
            [2, 3],
          ])
        : ONE_EGG
    );
    const stats = await processCatalysts([catalyst(1, "energy data"), catalyst(2, "energy policy")], 100);
    expect(stats.themesAnalyzed).toBe(1); // grouped, not 2
    expect(mocks.putCache).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION: rejects a catalyst with no canonical theme rather than minting a dead key", async () => {
    // theme_id 0 is the documented "nothing fits" signal. Previously an
    // invented theme string passed straight through into a one-off cache key.
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierIdResponse([[1, 0]]) : ONE_EGG
    );
    const stats = await processCatalysts([catalyst(1, "monetary policy")], 100);
    expect(stats.catalystsKept).toBe(0);
    expect(stats.themesAnalyzed).toBe(0);
    expect(mocks.putCache).not.toHaveBeenCalled();
    // and no premium call was spent
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects an out-of-range theme_id (a hallucinated index)", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierIdResponse([[1, 999]]) : ONE_EGG
    );
    const stats = await processCatalysts([catalyst(1, "x")], 100);
    expect(stats.catalystsKept).toBe(0);
  });

  it("records the canonical theme on the catalyst so rollups don't use the feed label", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierIdResponse([[1, 2]]) : ONE_EGG
    );
    await processCatalysts([catalyst(1, "energy data")], 100);
    expect(mocks.markCatalystAnalyzed).toHaveBeenCalledWith(1, expect.any(Number), CANONICAL_THEMES[1]);
  });
});

describe("processCatalysts — cache behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCache.mockResolvedValue(undefined);
  });

  it("does not cache an empty ripple result (would poison the theme for 30 days)", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1], ["Quantum computing"]) : JSON.stringify({ eggs: [] })
    );

    await processCatalysts([catalyst(1, "a")], 100);

    expect(mocks.putCache).not.toHaveBeenCalled();
  });

  it("caches a non-empty ripple result", async () => {
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1], ["Quantum computing"]) : ONE_EGG
    );

    await processCatalysts([catalyst(1, "a")], 100);

    expect(mocks.putCache).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh cache entry instead of spending a premium call", async () => {
    mocks.getCache.mockResolvedValue({
      id: 1,
      outputJson: ONE_EGG,
      expiresAt: Date.now() + 86_400_000,
    } as any);
    mocks.complete.mockImplementation(async (_p: string, o: any) =>
      o?.tier === "cheap" ? classifierResponse([1], ["Quantum computing"]) : ONE_EGG
    );

    const stats = await processCatalysts([catalyst(1, "a")], 100);

    expect(stats.cacheHits).toBe(1);
    expect(stats.themesAnalyzed).toBe(0);
    // only the cheap classifier call — no premium call
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
