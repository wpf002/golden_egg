/**
 * Second-hop lag analysis — the empirical test of the app's whole premise.
 *
 * The thesis is that a catalyst hits the obvious 1st-order name first, and the
 * 2nd/3rd-order "picks and shovels" names move later. If true, the lag is the
 * edge: you have time to buy the 2nd-order name after the catalyst is public.
 * If hop-2 names move at the same time (or earlier), there is no edge and the
 * ripple framing is decoration.
 *
 * This measures it instead of assuming it. Pure functions over cached closes —
 * no network, no credits.
 */

export type EggSeries = {
  eggId: number;
  ticker: string;
  hopDistance: number;
  flagDate: string;
  closes: { date: string; close: number }[];
};

/** Whole days between two YYYY-MM-DD dates. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(fromYmd + "T00:00:00Z");
  const b = Date.parse(toYmd + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Days from the flag date until the price first moved `thresholdPct` from its
 * flag-date close, in either direction.
 *
 * Direction-agnostic on purpose: we're timing when the market *reacted*, not
 * whether the thesis was right. A 2nd-order name selling off on a catalyst is
 * still the market pricing that catalyst in.
 *
 * Returns null when it never moved that far in the window — treating "no move"
 * as a large lag would silently invent evidence for the thesis.
 */
export function daysToFirstMove(
  closes: { date: string; close: number }[],
  flagDate: string,
  thresholdPct: number
): number | null {
  const inWindow = closes.filter((c) => c.date >= flagDate);
  if (inWindow.length < 2) return null;
  const base = inWindow[0].close;
  if (!base || base <= 0) return null;

  for (const c of inWindow.slice(1)) {
    const move = Math.abs((c.close - base) / base) * 100;
    if (move >= thresholdPct) return daysBetween(inWindow[0].date, c.date);
  }
  return null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type HopLagRow = {
  hopDistance: number;
  /** Eggs at this hop that moved at all within the window. */
  moved: number;
  /** Eggs at this hop that never crossed the threshold. */
  neverMoved: number;
  medianDaysToMove: number | null;
  meanDaysToMove: number | null;
};

export type HopLagResult = {
  thresholdPct: number;
  byHop: HopLagRow[];
  /** medianDays(hop2) - medianDays(hop1). Positive = 2nd-order lagged, as the thesis predicts. */
  hop1ToHop2LagDays: number | null;
  /** Plain-language read of the result, including "not enough data". */
  verdict: string;
};

export function analyzeHopLag(series: EggSeries[], thresholdPct = 3): HopLagResult {
  const byHopMap = new Map<number, { lags: number[]; neverMoved: number }>();

  for (const s of series) {
    const bucket = byHopMap.get(s.hopDistance) ?? { lags: [], neverMoved: 0 };
    const lag = daysToFirstMove(s.closes, s.flagDate, thresholdPct);
    if (lag === null) bucket.neverMoved++;
    else bucket.lags.push(lag);
    byHopMap.set(s.hopDistance, bucket);
  }

  const byHop: HopLagRow[] = [...byHopMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hopDistance, b]) => ({
      hopDistance,
      moved: b.lags.length,
      neverMoved: b.neverMoved,
      medianDaysToMove: median(b.lags),
      meanDaysToMove: b.lags.length ? b.lags.reduce((s, v) => s + v, 0) / b.lags.length : null,
    }));

  const h1 = byHop.find((h) => h.hopDistance === 1);
  const h2 = byHop.find((h) => h.hopDistance === 2);

  // Require a real sample on both sides. A "lag" computed from one egg per hop
  // is noise, and reporting it as a finding would be worse than saying nothing.
  const MIN_SAMPLE = 3;
  let hop1ToHop2LagDays: number | null = null;
  let verdict: string;

  if (!h1 || !h2 || h1.moved < MIN_SAMPLE || h2.moved < MIN_SAMPLE) {
    verdict = `Not enough data: needs ${MIN_SAMPLE}+ eggs that moved at both hop 1 and hop 2 (have ${h1?.moved ?? 0} and ${h2?.moved ?? 0}). Widen the close-cache window or lower the threshold.`;
  } else {
    hop1ToHop2LagDays = (h2.medianDaysToMove ?? 0) - (h1.medianDaysToMove ?? 0);
    if (hop1ToHop2LagDays > 0) {
      verdict = `2nd-order names moved ${hop1ToHop2LagDays.toFixed(1)} days after 1st-order — consistent with the parallel-markets thesis.`;
    } else if (hop1ToHop2LagDays === 0) {
      verdict = `1st- and 2nd-order names moved on the same day — no timing edge in this sample.`;
    } else {
      verdict = `2nd-order names moved ${Math.abs(hop1ToHop2LagDays).toFixed(1)} days BEFORE 1st-order — the opposite of the thesis in this sample.`;
    }
  }

  return { thresholdPct, byHop, hop1ToHop2LagDays, verdict };
}
