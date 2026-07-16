/**
 * Finance helper — thin, stable facade over the pluggable quotes provider
 * (see providers/quotes.ts). Keeps the historical `fetchQuotes` / `fetchDailyCloses`
 * / `toYmd` signatures so callers (routes.ts, ripple.ts) are untouched.
 *
 * The sandbox `external-tool` CLI dependency has been removed — the backend is
 * Finnhub, selected via QUOTES_PROVIDER.
 */
import { getQuotes, getCandles } from "./providers/quotes";

/** Fetch latest price for tickers. Returns { TICKER: price } (numbers). Batched. */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  return getQuotes().quotes(tickers);
}

/** Historical daily closes for one ticker in [startYmd, endYmd]. Returns [{date, close}] sorted asc. */
export async function fetchDailyCloses(
  ticker: string,
  startYmd: string,
  endYmd: string
): Promise<{ date: string; close: number }[]> {
  // Candles resolve independently of spot quotes — see providers/quotes.ts.
  return getCandles().ohlcv(ticker, startYmd, endYmd);
}

/** ymd for a given unix ms timestamp. */
export function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
