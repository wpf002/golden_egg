/**
 * Price alerts for watchlist eggs.
 *
 * Free by design: this reads quote data only — no LLM, no credits. It piggybacks
 * on the price refresh the user already triggers, so alerts appear without any
 * extra background chatter.
 *
 * Dedupe rule: while an alert for the same egg+direction is still
 * unacknowledged, no new one is recorded. Otherwise a stock parked above the
 * threshold would emit a fresh alert on every single check.
 */
import type { GoldenEgg } from "@shared/schema";
import { storage } from "../storage";
import { log } from "../logger";

const logger = log("alerts");

export type AlertCandidate = {
  eggId: number;
  direction: "gain" | "loss";
  returnPct: number;
  price: number;
};

/**
 * Decide which eggs have crossed the threshold. Pure — no I/O — so the rules are
 * testable without a DB.
 */
export function findCrossings(
  eggs: Pick<GoldenEgg, "id" | "priceAtFlag" | "currentPrice">[],
  thresholdPct: number
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const e of eggs) {
    const flag = e.priceAtFlag;
    const current = e.currentPrice;
    if (!flag || !current || flag <= 0) continue;

    const returnPct = ((current - flag) / flag) * 100;
    if (!Number.isFinite(returnPct)) continue;

    // Guard against the known corrupt flag prices (a $1 placeholder against a
    // $1,000 stock) — those would fire a bogus alert on every check.
    if (Math.abs(returnPct) > 1000) continue;

    if (returnPct >= thresholdPct) out.push({ eggId: e.id, direction: "gain", returnPct, price: current });
    else if (returnPct <= -thresholdPct)
      out.push({ eggId: e.id, direction: "loss", returnPct, price: current });
  }
  return out;
}

/**
 * Evaluate the watchlist against the threshold and record new alerts.
 * Assumes prices were refreshed recently (the refresh route calls this).
 */
export async function evaluateAlerts(thresholdPct: number): Promise<{ created: number; checked: number }> {
  const watchlist = await storage.listWatchlist();
  const crossings = findCrossings(watchlist, thresholdPct);

  let created = 0;
  for (const c of crossings) {
    const existing = await storage.getOpenAlert(c.eggId, c.direction);
    if (existing) continue; // already alerted and not yet acknowledged
    await storage.createAlert({
      eggId: c.eggId,
      direction: c.direction,
      thresholdPct,
      returnPct: c.returnPct,
      priceAtAlert: c.price,
      createdAt: Date.now(),
      acknowledgedAt: null,
    });
    created++;
  }

  if (created > 0) logger.info({ created, checked: watchlist.length, thresholdPct }, "price alerts recorded");
  return { created, checked: watchlist.length };
}
