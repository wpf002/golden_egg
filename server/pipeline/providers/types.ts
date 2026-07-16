/**
 * Shared provider contract.
 *
 * Lives in its own module so concrete providers (finnhub, polygon) depend on the
 * interface rather than on each other — the factory imports both, so keeping the
 * types here avoids an import cycle.
 */

export type GainerRow = { symbol: string; name: string; changePct: string };

/**
 * Thrown when a model hit its token cap mid-response.
 *
 * This existed silently and cost real money: analyzeTheme asked for 4-8 eggs
 * with full theses inside max_tokens:3000, the reply was cut off mid-JSON,
 * parsing returned null, and the caller reported "0 eggs" — after paying for
 * the premium call. Truncation must be loud, not a shrug.
 */
export class LlmTruncatedError extends Error {
  constructor(public readonly chars: number) {
    super(`Model response hit the token cap after ${chars} chars — raise maxTokens for this call`);
    this.name = "LlmTruncatedError";
  }
}

export interface QuotesProvider {
  /** Latest price per ticker. Batched — never one request per ticker if avoidable. */
  quotes(tickers: string[]): Promise<Record<string, number>>;
  /** Daily closes in [startYmd, endYmd], ascending. Empty when unavailable. */
  ohlcv(ticker: string, startYmd: string, endYmd: string): Promise<{ date: string; close: number }[]>;
  /** Day's top movers. Empty when the plan doesn't include a screener. */
  marketGainers(): Promise<GainerRow[]>;
  /**
   * Every ticker's close for one day, in ONE request.
   *
   * This is the difference between a viable and an unusable backtest on a
   * rate-limited plan: cost scales with days, not tickers. Returns null when
   * the provider has no such endpoint, so callers can fall back to per-ticker.
   */
  groupedCloses?(dateYmd: string): Promise<Record<string, number> | null>;
}

/** Transient failures (429/timeouts) get a couple of backoff retries before giving up. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
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
