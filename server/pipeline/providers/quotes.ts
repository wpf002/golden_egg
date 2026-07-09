/**
 * Quotes / OHLCV provider abstraction.
 *
 * Replaces the sandbox `external-tool` finance connector with a pluggable
 * interface. Backend is Finnhub (keyed, reliable). Free tier covers real-time
 * `/quote`; historical candles and the gainers screener are paid-only, so those
 * methods degrade gracefully (warn + empty) rather than throw.
 *
 * The pipeline batches: `quotes()` takes many tickers at once.
 */
import { env } from "../../config";

export type GainerRow = { symbol: string; name: string; changePct: string };

export interface QuotesProvider {
  quotes(tickers: string[]): Promise<Record<string, number>>;
  ohlcv(ticker: string, startYmd: string, endYmd: string): Promise<{ date: string; close: number }[]>;
  marketGainers(): Promise<GainerRow[]>;
}

// Transient failures (429/timeouts) get a couple of backoff retries before giving up.
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = /Too Many Requests|429|ETIMEDOUT|ECONNRESET|fetch failed/i.test((e as Error).message);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i)); // 400ms, 800ms
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------
// Finnhub (keyed, reliable)
// ---------------------------------------------------------------
class FinnhubProvider implements QuotesProvider {
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
    const uniq = Array.from(new Set(tickers.map((t) => t.toUpperCase()))).filter(Boolean);
    // Finnhub /quote is one symbol per call; free tier allows 60/min. Run in
    // small concurrent batches to stay well under the limit.
    const CONCURRENCY = 5;
    for (let i = 0; i < uniq.length; i += CONCURRENCY) {
      const batch = uniq.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (sym) => {
          try {
            const q = await withRetry(() => this.get(`/quote?symbol=${encodeURIComponent(sym)}`), "finnhub quote");
            const p = q?.c; // current price
            if (Number.isFinite(p) && p > 0) out[sym] = p;
          } catch (e) {
            console.warn(`[quotes] finnhub quote ${sym} failed:`, (e as Error).message);
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
      const r = await withRetry(
        () => this.get(`/stock/candle?symbol=${encodeURIComponent(ticker.toUpperCase())}&resolution=D&from=${from}&to=${to}`),
        "finnhub candle"
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
      console.warn(`[quotes] finnhub ohlcv ${ticker} failed (candles need a paid plan):`, (e as Error).message);
      return [];
    }
  }

  async marketGainers(): Promise<GainerRow[]> {
    // No free gainers screener on Finnhub; market-signal ingest simply yields nothing.
    return [];
  }
}

let _quotes: QuotesProvider | null = null;
export function getQuotes(): QuotesProvider {
  if (_quotes) return _quotes;
  _quotes = new FinnhubProvider(); // extend here for polygon, etc.
  return _quotes;
}
