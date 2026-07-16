/**
 * Pure scoring logic for the backtest.
 *
 * Extracted from the route so the rules — especially the corrupt-flag-price
 * guard — are testable without a DB or a quotes provider.
 */

/**
 * Returns beyond this magnitude (%) indicate a corrupt flag price rather than a
 * real move, and are excluded from scoring. Some legacy rows carry a $1
 * placeholder against a $1,000 stock, which yields a five-figure "return" that
 * would swamp every rollup. A genuine 10x here is worth a manual look anyway.
 */
export const SUSPECT_RETURN_PCT = 1000;

export type ScoreInput = {
  closes: { date: string; close: number }[];
  flagDate: string;
  priceAtFlag: number | null;
  /** Last refreshed spot price — stands in when the plan has no daily candles. */
  currentPrice: number | null;
};

export type ScoreResult = {
  flagClose: number | null;
  latestClose: number | null;
  returnPct: number | null;
  /** Flag price looks corrupt; excluded from the rollups. */
  suspect: boolean;
};

export function scoreReturn({ closes, flagDate, priceAtFlag, currentPrice }: ScoreInput): ScoreResult {
  // First close on or after the flag date; fall back to the recorded flag price.
  const flagClose = closes.find((c) => c.date >= flagDate)?.close ?? priceAtFlag ?? null;
  // Prefer a real daily close; fall back to spot so the backtest still works
  // without a candles-capable provider.
  const latestClose = closes.length ? closes[closes.length - 1].close : (currentPrice ?? null);

  let returnPct: number | null = null;
  if (flagClose && latestClose && flagClose > 0) {
    returnPct = ((latestClose - flagClose) / flagClose) * 100;
  }

  let suspect = false;
  if (returnPct !== null && Math.abs(returnPct) > SUSPECT_RETURN_PCT) {
    suspect = true;
    returnPct = null; // keep it out of the rollups
  }

  return { flagClose, latestClose, returnPct, suspect };
}
