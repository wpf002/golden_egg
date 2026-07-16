/**
 * Finance helper — thin, stable facade over the pluggable providers
 * (see providers/quotes.ts). Keeps the historical `fetchQuotes` /
 * `fetchDailyCloses` / `toYmd` signatures so callers stay untouched.
 *
 * The sandbox `external-tool` CLI dependency has been removed.
 */
import { getQuotes } from "./providers/quotes";
import { storage } from "../storage";

/** Fetch latest price for tickers. Returns { TICKER: price } (numbers). Batched. */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  return getQuotes().quotes(tickers);
}

/**
 * Daily closes for one ticker in [startYmd, endYmd], ascending.
 *
 * Reads the local cache (see pipeline/closes.ts). We deliberately do NOT fall
 * back to a per-ticker provider call on a miss: on a rate-limited plan that's
 * what made the backtest take 10+ minutes. A miss means "run the backfill",
 * which costs one request per day for every ticker at once.
 */
export async function fetchDailyCloses(
  ticker: string,
  startYmd: string,
  endYmd: string
): Promise<{ date: string; close: number }[]> {
  return storage.getDailyCloses(ticker, startYmd, endYmd);
}

/** ymd for a given unix ms timestamp. */
export function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
