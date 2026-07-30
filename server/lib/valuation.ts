/**
 * Growth-adjusted valuation — "is this rider expensive relative to the giant
 * it's riding?"
 *
 * A raw multiple can't answer that. Credo trades at ~25x sales against
 * NVIDIA's ~18x and looks expensive, but it's growing ~157% against NVIDIA's
 * ~85% — per unit of growth it is the CHEAPER of the two. Comparing price to
 * sales alone would have said the opposite, which is precisely the mistake
 * this module exists to avoid.
 *
 * The ratio is P/S divided by revenue growth (a PEG built on sales, since the
 * emerging names in this app are often pre-earnings and have no meaningful
 * P/E). Lower = more growth bought per unit of price.
 *
 * Everything here is deliberately arithmetic on provider data, not model
 * opinion: the LLM proposes WHO rides whom, the numbers decide how it's priced.
 */

export type Fundamentals = {
  ticker: string;
  marketCapM: number | null; // millions
  priceToSales: number | null;
  peRatio: number | null;
  revenueGrowthPct: number | null; // YoY %, quarterly preferred
  grossMarginPct: number | null;
};

export type Verdict = "cheaper-for-the-growth" | "richer-for-the-growth" | "comparable" | "unknown";

/**
 * P/S per point of growth. Null when either input is missing or growth is
 * non-positive — a shrinking company can't be ranked on growth efficiency,
 * and dividing by ~0 would mint a meaningless spike.
 */
export function growthAdjusted(f: Pick<Fundamentals, "priceToSales" | "revenueGrowthPct">): number | null {
  const ps = f.priceToSales;
  const g = f.revenueGrowthPct;
  if (ps == null || g == null) return null;
  if (!Number.isFinite(ps) || !Number.isFinite(g)) return null;
  if (ps <= 0 || g <= 0) return null;
  return ps / g;
}

/**
 * Compare a rider against its anchor. The band is intentionally wide (±25%):
 * these are noisy TTM figures from a free data tier, and a 5% difference is
 * not a signal worth a verdict.
 */
export function compareValuation(
  rider: Fundamentals,
  anchor: Fundamentals
): { verdict: Verdict; riderRatio: number | null; anchorRatio: number | null; premiumPct: number | null } {
  const riderRatio = growthAdjusted(rider);
  const anchorRatio = growthAdjusted(anchor);
  if (riderRatio == null || anchorRatio == null) {
    return { verdict: "unknown", riderRatio, anchorRatio, premiumPct: null };
  }
  const premiumPct = ((riderRatio - anchorRatio) / anchorRatio) * 100;
  const verdict: Verdict =
    premiumPct > 25 ? "richer-for-the-growth" : premiumPct < -25 ? "cheaper-for-the-growth" : "comparable";
  return { verdict, riderRatio, anchorRatio, premiumPct };
}

/**
 * How much smaller the rider is than its anchor, as a multiple of market cap.
 * The whole premise is riders are small enough that the anchor's growth can
 * still move them; 100x smaller means far more headroom than 2x smaller.
 */
export function sizeRatio(rider: Fundamentals, anchor: Fundamentals): number | null {
  if (!rider.marketCapM || !anchor.marketCapM) return null;
  if (rider.marketCapM <= 0) return null;
  return anchor.marketCapM / rider.marketCapM;
}

/** Human summary of the comparison, for the card and the export. */
export function describeComparison(
  riderTicker: string,
  anchorTicker: string,
  cmp: ReturnType<typeof compareValuation>,
  size: number | null
): string {
  const sizeBit =
    size && size >= 2 ? `${riderTicker} is ~${Math.round(size)}x smaller than ${anchorTicker}. ` : "";
  if (cmp.verdict === "unknown") {
    return `${sizeBit}Not enough reported figures to price ${riderTicker} against ${anchorTicker} yet.`;
  }
  const pct = Math.abs(Math.round(cmp.premiumPct ?? 0));
  if (cmp.verdict === "cheaper-for-the-growth") {
    return `${sizeBit}${riderTicker} buys about ${pct}% more growth per unit of price than ${anchorTicker}.`;
  }
  if (cmp.verdict === "richer-for-the-growth") {
    return `${sizeBit}${riderTicker} costs about ${pct}% more per unit of growth than ${anchorTicker} — the story is already priced in.`;
  }
  return `${sizeBit}${riderTicker} and ${anchorTicker} are priced about the same for the growth they're putting up.`;
}
