/**
 * Confidence calibration — the feedback loop.
 *
 * The model grades its own picks (confidence 0–1), but a self-grade is not a
 * probability. Once picks have real price history, we know how each theme has
 * ACTUALLY done — and the app should trust results over self-assessment,
 * increasingly so as evidence accumulates.
 *
 * The blend is empirical-Bayes shrinkage:
 *
 *   calibrated = w · modelConfidence + (1 − w) · themeWinRate,  w = K / (K + n)
 *
 * With no outcomes (n = 0) the model's number passes through untouched. As a
 * theme racks up scored picks, its realized win rate takes over. K sets how
 * much evidence it takes to move: K = 10 means ten scored picks pull the blend
 * halfway. This can only ever be as good as the outcome data — early on it
 * moves numbers slightly; after months of scans it IS the number.
 */

export type OutcomeRow = {
  theme: string;
  confidence: number;
  /** Realized return since flag, or null when unscoreable. */
  returnPct: number | null;
};

export type ThemeCalibration = {
  theme: string;
  /** Scored picks (null returns excluded). */
  n: number;
  wins: number;
  winRate: number;
  avgModelConfidence: number;
};

const K = 10;

export function computeCalibration(rows: OutcomeRow[]): Map<string, ThemeCalibration> {
  const byTheme = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    if (r.returnPct == null) continue;
    (byTheme.get(r.theme) ?? byTheme.set(r.theme, []).get(r.theme))!.push(r);
  }
  const out = new Map<string, ThemeCalibration>();
  for (const [theme, list] of byTheme) {
    const wins = list.filter((r) => (r.returnPct ?? 0) > 0).length;
    out.set(theme, {
      theme,
      n: list.length,
      wins,
      winRate: wins / list.length,
      avgModelConfidence: list.reduce((s, r) => s + r.confidence, 0) / list.length,
    });
  }
  return out;
}

/** Blend a model confidence with its theme's track record. */
export function calibrate(modelConfidence: number, cal: ThemeCalibration | undefined): number {
  if (!cal || cal.n === 0) return modelConfidence;
  const w = K / (K + cal.n);
  return w * modelConfidence + (1 - w) * cal.winRate;
}
