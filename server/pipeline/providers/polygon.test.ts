import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.POLYGON_API_KEY = "test-key";
process.env.POLYGON_RPM = "6000"; // effectively no delay in tests

const { PolygonProvider } = await import("./polygon");

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** Polygon `t` is epoch **milliseconds** (Finnhub's is seconds) — easy to get wrong. */
const ms = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("PolygonProvider.ohlcv", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps aggregate bars to sorted {date, close}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonRes({
          results: [
            { c: 12, t: ms(2026, 1, 2) },
            { c: 10, t: ms(2026, 1, 1) },
          ],
        })
      )
    );
    const rows = await new PolygonProvider().ohlcv("AAPL", "2026-01-01", "2026-01-02");
    expect(rows).toEqual([
      { date: "2026-01-01", close: 10 },
      { date: "2026-01-02", close: 12 },
    ]);
  });

  it("treats `t` as milliseconds, not seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ results: [{ c: 1, t: ms(2026, 6, 15) }] }))
    );
    const rows = await new PolygonProvider().ohlcv("AAPL", "2026-06-01", "2026-06-30");
    expect(rows[0].date).toBe("2026-06-15"); // seconds would land in 1970
  });

  it("drops bars with a non-finite close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonRes({
          results: [
            { c: null, t: ms(2026, 1, 1) },
            { c: 5, t: ms(2026, 1, 2) },
          ],
        })
      )
    );
    const rows = await new PolygonProvider().ohlcv("AAPL", "2026-01-01", "2026-01-02");
    expect(rows).toEqual([{ date: "2026-01-02", close: 5 }]);
  });

  it("returns empty on an API error rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ error: "nope" }, 403))
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await new PolygonProvider().ohlcv("AAPL", "2026-01-01", "2026-01-02")).toEqual([]);
  });

  it("returns empty when there are no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ resultsCount: 0 }))
    );
    expect(await new PolygonProvider().ohlcv("AAPL", "2026-01-01", "2026-01-02")).toEqual([]);
  });
});

describe("PolygonProvider.quotes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("pulls every requested ticker out of ONE grouped-bars request", async () => {
    const spy = vi.fn(async () =>
      jsonRes({
        results: [
          { T: "AAPL", c: 100 },
          { T: "CEG", c: 250 },
          { T: "ZZZZ", c: 9 }, // not requested — must be ignored
        ],
      })
    );
    vi.stubGlobal("fetch", spy);
    const out = await new PolygonProvider().quotes(["AAPL", "CEG"]);
    expect(out).toEqual({ AAPL: 100, CEG: 250 });
    // The whole point: 1 request regardless of ticker count (5 req/min cap).
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("walks back to the previous trading day when a day returns no bars", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        // First day is a weekend/holiday: empty results.
        return call === 1 ? jsonRes({ results: [] }) : jsonRes({ results: [{ T: "AAPL", c: 42 }] });
      })
    );
    const out = await new PolygonProvider().quotes(["AAPL"]);
    expect(out).toEqual({ AAPL: 42 });
    expect(call).toBe(2);
  });

  it("uppercases/trims input and ignores blanks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ results: [{ T: "AAPL", c: 7 }] }))
    );
    expect(await new PolygonProvider().quotes([" aapl ", "  "])).toEqual({ AAPL: 7 });
  });

  it("returns empty for an empty ticker list without calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await new PolygonProvider().quotes([])).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});
