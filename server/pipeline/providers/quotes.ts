/**
 * Quotes / candles provider resolution.
 *
 * Replaces the sandbox `external-tool` finance connector with a pluggable
 * interface (see ./types.ts). Quotes and candles resolve *separately* because no
 * free tier does both well:
 *   - Finnhub free: real-time quotes (60/min), but candles are paid-only.
 *   - Polygon free: daily candles, but end-of-day and ~5 req/min.
 * CANDLES_PROVIDER defaults to QUOTES_PROVIDER, so a single-provider setup works
 * unchanged.
 */
import { env, candlesProvider } from "../../config";
import { log } from "../../logger";
import { type QuotesProvider, type GainerRow, type NewsItem, withRetry } from "./types";
import { PolygonProvider } from "./polygon";

export type { QuotesProvider, GainerRow } from "./types";

const logger = log("quotes");

// ---------------------------------------------------------------
// Finnhub — real-time quotes on the free tier; no candles, no screener.
// ---------------------------------------------------------------
export class FinnhubProvider implements QuotesProvider {
  private base = "https://finnhub.io/api/v1";
  private key = env.FINNHUB_API_KEY ?? "";

  private async get(path: string): Promise<any> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${this.base}${path}${sep}token=${this.key}`);
    if (res.status === 429) throw new Error("Too Many Requests");
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 80)}`);
    return res.json();
  }

  async quotes(tickers: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    // trim before filtering — a whitespace-only ticker is truthy and would
    // otherwise burn a request on a junk symbol
    const uniq = Array.from(new Set(tickers.map((t) => t.trim().toUpperCase()))).filter(Boolean);
    // Finnhub /quote is one symbol per call; free tier allows 60/min. Run in
    // small concurrent batches to stay well under the limit.
    const CONCURRENCY = 5;
    for (let i = 0; i < uniq.length; i += CONCURRENCY) {
      const batch = uniq.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (sym) => {
          try {
            const q = await withRetry(() => this.get(`/quote?symbol=${encodeURIComponent(sym)}`));
            const p = q?.c; // current price
            if (Number.isFinite(p) && p > 0) out[sym] = p;
          } catch (e) {
            logger.warn({ err: e, symbol: sym }, "finnhub quote failed");
          }
        })
      );
    }
    return out;
  }

  async ohlcv(ticker: string, startYmd: string, endYmd: string): Promise<{ date: string; close: number }[]> {
    try {
      const from = Math.floor(new Date(startYmd + "T00:00:00Z").getTime() / 1000);
      const to = Math.floor(new Date(endYmd + "T23:59:59Z").getTime() / 1000);
      const r = await withRetry(() =>
        this.get(
          `/stock/candle?symbol=${encodeURIComponent(ticker.toUpperCase())}&resolution=D&from=${from}&to=${to}`
        )
      );
      if (r?.s !== "ok" || !Array.isArray(r?.c)) return [];
      const out: { date: string; close: number }[] = [];
      for (let i = 0; i < r.c.length; i++) {
        const close = r.c[i];
        const d = new Date(r.t[i] * 1000).toISOString().slice(0, 10);
        if (Number.isFinite(close)) out.push({ date: d, close });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    } catch (e) {
      logger.warn({ err: e, ticker }, "finnhub ohlcv failed (candles require a paid plan)");
      return [];
    }
  }

  async marketGainers(): Promise<GainerRow[]> {
    // No free gainers screener on Finnhub; market-signal ingest simply yields nothing.
    return [];
  }

  async companyName(ticker: string): Promise<string | null> {
    try {
      const r = await withRetry(() =>
        this.get(`/stock/profile2?symbol=${encodeURIComponent(ticker.trim().toUpperCase())}`)
      );
      const name = typeof r?.name === "string" ? r.name.trim() : "";
      return name || null;
    } catch (e) {
      logger.warn({ err: e, ticker }, "finnhub profile lookup failed");
      return null;
    }
  }

  async marketNews(category: string): Promise<NewsItem[]> {
    try {
      const rows = await withRetry(() => this.get(`/news?category=${encodeURIComponent(category)}`));
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r: any): NewsItem => ({
          id: String(r?.id ?? r?.url ?? ""),
          headline: typeof r?.headline === "string" ? r.headline.trim() : "",
          summary: typeof r?.summary === "string" ? r.summary.trim() : "",
          url: typeof r?.url === "string" && r.url ? r.url : null,
          // Finnhub reports unix seconds.
          datetime: Number.isFinite(r?.datetime) ? r.datetime * 1000 : 0,
        }))
        .filter((n) => n.id && n.headline);
    } catch (e) {
      logger.warn({ err: e, category }, "finnhub news fetch failed");
      return [];
    }
  }
}

// ---------------------------------------------------------------
// Factories
// ---------------------------------------------------------------
function build(name: "finnhub" | "polygon"): QuotesProvider {
  return name === "polygon" ? new PolygonProvider() : new FinnhubProvider();
}

let _quotes: QuotesProvider | null = null;
let _candles: QuotesProvider | null = null;

/** Provider for spot prices and gainers. */
export function getQuotes(): QuotesProvider {
  if (!_quotes) _quotes = build(env.QUOTES_PROVIDER);
  return _quotes;
}

/** Provider for daily closes (backtest, sparklines). */
export function getCandles(): QuotesProvider {
  if (!_candles) _candles = build(candlesProvider);
  return _candles;
}

/** Test seam: drop memoized providers so env changes take effect. */
export function __resetProviders(): void {
  _quotes = null;
  _candles = null;
}
