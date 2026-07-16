import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// config reads process.env at import; give it what the Finnhub provider needs.
process.env.QUOTES_PROVIDER = "finnhub";
process.env.FINNHUB_API_KEY = "test-key";

const { getQuotes } = await import("./quotes");

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("FinnhubProvider.quotes", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("maps each symbol to its current price (field `c`)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sym = new URL(url).searchParams.get("symbol");
        const prices: Record<string, number> = { AAPL: 316.44, CEG: 250.88 };
        return jsonRes({ c: prices[sym!], pc: 1 });
      })
    );
    const out = await getQuotes().quotes(["AAPL", "CEG"]);
    expect(out).toEqual({ AAPL: 316.44, CEG: 250.88 });
  });

  it("uppercases and de-duplicates tickers before fetching", async () => {
    const spy = vi.fn(async () => jsonRes({ c: 10 }));
    vi.stubGlobal("fetch", spy);
    const out = await getQuotes().quotes(["aapl", "AAPL", "  "]);
    expect(out).toEqual({ AAPL: 10 });
    expect(spy).toHaveBeenCalledTimes(1); // deduped to a single request
  });

  it("skips symbols with no/zero price rather than recording a bogus 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sym = new URL(url).searchParams.get("symbol");
        return jsonRes(sym === "GOOD" ? { c: 42 } : { c: 0 }); // Finnhub returns c:0 for unknown symbols
      })
    );
    const out = await getQuotes().quotes(["GOOD", "BOGUS"]);
    expect(out).toEqual({ GOOD: 42 });
  });

  it("isolates a failing symbol without losing the rest of the batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sym = new URL(url).searchParams.get("symbol");
        if (sym === "BAD") return jsonRes({ error: "Invalid API key." }, 401);
        return jsonRes({ c: 7 });
      })
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await getQuotes().quotes(["OK1", "BAD", "OK2"]);
    expect(out).toEqual({ OK1: 7, OK2: 7 });
  });

  it("returns an empty map for an empty ticker list without calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getQuotes().quotes([])).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("FinnhubProvider.ohlcv", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps candle arrays into sorted {date, close} rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonRes({
          s: "ok",
          c: [10, 12],
          t: [Date.UTC(2026, 0, 2) / 1000, Date.UTC(2026, 0, 1) / 1000], // out of order on purpose
        })
      )
    );
    const rows = await getQuotes().ohlcv("AAPL", "2026-01-01", "2026-01-02");
    expect(rows).toEqual([
      { date: "2026-01-01", close: 12 },
      { date: "2026-01-02", close: 10 },
    ]);
  });

  it("degrades to an empty array when candles are unavailable (free-tier/paid gate)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ error: "premium" }, 403))
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getQuotes().ohlcv("AAPL", "2026-01-01", "2026-01-02")).toEqual([]);
  });

  it("returns empty when Finnhub reports no_data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ s: "no_data" }))
    );
    expect(await getQuotes().ohlcv("AAPL", "2026-01-01", "2026-01-02")).toEqual([]);
  });
});

describe("FinnhubProvider.marketGainers", () => {
  it("returns empty (no free gainers screener) without throwing", async () => {
    expect(await getQuotes().marketGainers()).toEqual([]);
  });
});
