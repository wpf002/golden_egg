/**
 * Return-vs-flag for display.
 *
 * Mirrors the server's backtest guard (server/lib/backtest.ts): some legacy eggs
 * carry a placeholder flag price (a $1 stand-in against a $1,000 stock), which
 * renders as "+102,806%" on the card. That's obviously wrong to a reader and
 * corrodes trust in every other number on screen, so we suppress it and say the
 * flag price is bad instead of showing a fake moonshot.
 */

/** Keep in step with SUSPECT_RETURN_PCT in server/lib/backtest.ts. */
export const SUSPECT_RETURN_PCT = 1000;

export type ReturnInfo = {
  /** null when unscoreable or the flag price looks corrupt. */
  pct: number | null;
  /** true when a return was computable but is implausible => bad flag price. */
  suspect: boolean;
};

export function returnVsFlag(priceAtFlag: number | null, currentPrice: number | null): ReturnInfo {
  if (priceAtFlag == null || currentPrice == null || priceAtFlag <= 0) {
    return { pct: null, suspect: false };
  }
  const pct = ((currentPrice - priceAtFlag) / priceAtFlag) * 100;
  if (!Number.isFinite(pct)) return { pct: null, suspect: false };
  if (Math.abs(pct) > SUSPECT_RETURN_PCT) return { pct: null, suspect: true };
  return { pct, suspect: false };
}

/** Tailwind text colour for a delta. */
export function deltaColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct > 0) return "text-emerald-400";
  if (pct < 0) return "text-rose-400";
  return "text-muted-foreground";
}
