/**
 * Polygon.io quotes/candles provider.
 *
 * Why this exists alongside Finnhub: the free tiers are good at opposite things.
 * Finnhub free gives real-time quotes (60/min) but no historical candles;
 * Polygon free gives daily candles but caps at ~5 requests/min and is
 * end-of-day only. So candles come from here and live quotes can stay on
 * Finnhub — see CANDLES_PROVIDER in config.ts.
 *
 * The 5/min cap is the binding constraint: a per-ticker fan-out would take
 * minutes for a full backtest. Two mitigations:
 *   - quotes() uses the *grouped* daily-bars endpoint — one request returns
 *     every US ticker's close, instead of one request per ticker.
 *   - all requests go through a rate limiter so we degrade gracefully instead
 *     of getting 429'd.
 */
import { env } from "../../config";
import { log } from "../../logger";
import type { QuotesProvider, GainerRow } from "./types";

const logger = log("polygon");

/** Serialize requests with a minimum gap, to respect the plan's rate limit. */
class RateLimiter {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.chain.then(async () => {
      const wait = this.minGapMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    // Keep the chain alive even if a task rejects.
    this.chain = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class PolygonProvider implements QuotesProvider {
  private base = "https://api.polygon.io";
  private key = env.POLYGON_API_KEY ?? "";
  private limiter = new RateLimiter(Math.ceil(60_000 / Math.max(1, env.POLYGON_RPM)));

  private async get(path: string): Promise<any> {
    return this.limiter.run(async () => {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${this.base}${path}${sep}apiKey=${this.key}`);
      if (res.status === 429) throw new Error("Too Many Requests");
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 100)}`);
      return res.json();
    });
  }

  /**
   * Closes for every US ticker on the most recent trading day, in one request.
   * Walks back day-by-day because weekends/holidays return an empty result set.
   */
  async quotes(tickers: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const want = new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
    if (want.size === 0) return out;

    for (let back = 0; back < 5; back++) {
      const day = new Date(Date.now() - back * 86_400_000);
      try {
        const r = await this.get(`/v2/aggs/grouped/locale/us/market/stocks/${ymd(day)}?adjusted=true`);
        const results = (r?.results ?? []) as any[];
        if (results.length === 0) continue; // non-trading day — step back
        for (const bar of results) {
          const sym = String(bar?.T ?? "").toUpperCase();
          if (want.has(sym) && Number.isFinite(bar?.c)) out[sym] = bar.c;
        }
        return out;
      } catch (e) {
        logger.warn({ err: e, date: ymd(day) }, "polygon grouped bars failed");
        return out;
      }
    }
    return out;
  }

  async ohlcv(ticker: string, startYmd: string, endYmd: string): Promise<{ date: string; close: number }[]> {
    try {
      const r = await this.get(
        `/v2/aggs/ticker/${encodeURIComponent(ticker.toUpperCase())}/range/1/day/${startYmd}/${endYmd}?adjusted=true&sort=asc&limit=50000`
      );
      const results = (r?.results ?? []) as any[];
      const out: { date: string; close: number }[] = [];
      for (const bar of results) {
        // Polygon's `t` is a unix epoch in milliseconds.
        if (!Number.isFinite(bar?.c) || !Number.isFinite(bar?.t)) continue;
        out.push({ date: new Date(bar.t).toISOString().slice(0, 10), close: bar.c });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    } catch (e) {
      logger.warn({ err: e, ticker }, "polygon aggregates failed");
      return [];
    }
  }

  async marketGainers(): Promise<GainerRow[]> {
    try {
      const r = await this.get("/v2/snapshot/locale/us/markets/stocks/gainers");
      const rows = (r?.tickers ?? []) as any[];
      return rows
        .map((t) => ({
          symbol: String(t?.ticker ?? "").toUpperCase(),
          name: String(t?.ticker ?? ""),
          changePct: Number.isFinite(t?.todaysChangePerc) ? `${t.todaysChangePerc.toFixed(2)}%` : "",
        }))
        .filter((r) => r.symbol);
    } catch (e) {
      // Snapshots are a paid entitlement on some plans — degrade quietly.
      logger.warn({ err: e }, "polygon gainers unavailable (likely a paid entitlement)");
      return [];
    }
  }
}
