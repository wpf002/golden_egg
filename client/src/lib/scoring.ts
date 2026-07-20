/**
 * How we rank eggs — tuned for "the ships, not the tide."
 *
 * The tide (the obvious first-order play) is what everyone already owns; the
 * whole point of this app is the boats further down the supply chain. So the
 * score deliberately leans away from hop-1 names and toward hop-2/3:
 *
 *   score = confidence × (1 + novelty) × hopWeight
 *
 * Confidence prefers the calibrated figure when the server provides one — the
 * blend of the model's self-grade and the theme's realized win rate — so
 * themes that keep losing sink in the ranking no matter how confident the
 * model sounds.
 */
const HOP_WEIGHT: Record<number, number> = {
  1: 0.85, // the tide — visible to everyone, least edge
  2: 1.0, // the ships
  3: 1.1, // the ships nobody's watching
};

export type ScorableEgg = {
  confidence: number;
  calibratedConfidence?: number;
  noveltyScore: number;
  hopDistance: number;
};

export function eggScore(e: ScorableEgg): number {
  const conf = e.calibratedConfidence ?? e.confidence;
  const weight = HOP_WEIGHT[e.hopDistance] ?? 1;
  return conf * (1 + (e.noveltyScore ?? 0.5)) * weight;
}
