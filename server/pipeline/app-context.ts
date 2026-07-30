/**
 * A compact, factual brief of what the app currently knows.
 *
 * Both the chat and the recommendations run on this. It exists so those
 * features answer from the app's OWN data — its picks, its realized results,
 * its graph — rather than from the model's memory of the market. Anything the
 * model says that isn't in here is unanchored, and the prompts say so.
 *
 * Everything is truncated aggressively: this is assembled on every question,
 * so it has to stay small enough to be cheap and current enough to be true.
 */
import { storage } from "../storage";
import { rollupTheme } from "@shared/schema";
import { computeCalibration, calibrate, type OutcomeRow } from "../lib/calibration";
import { scoreReturn } from "../lib/backtest";
import { toYmd } from "./finance";

const TOP_EGGS = 25;
const TOP_COATTAILS = 12;

export type AppContext = { text: string; eggCount: number; asOf: number };

function pct(v: number | null | undefined, digits = 0): string {
  return v == null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`;
}

export async function buildAppContext(): Promise<AppContext> {
  const [eggs, coattails, scans, alerts, nodes, edges, customThemes] = await Promise.all([
    storage.listEggs({ limit: 400 }),
    storage.listCoattailPicks(TOP_COATTAILS),
    storage.listScanRuns(5),
    storage.listAlerts(10),
    storage.listNodes(),
    storage.listAllEdges(),
    storage.listCustomThemes(),
  ]);

  // Realized outcomes, reusing the same "too new to score" rule as the
  // backtest so the brief can't claim a day-old pick lost money.
  const closes = await storage.getClosesSince(toYmd(Date.now() - 180 * 86_400_000));
  const outcomes: OutcomeRow[] = [];
  const returnByEgg = new Map<number, number | null>();
  for (const e of eggs) {
    const tooNew = Date.now() - (e.priceAtFlagDate ?? e.createdAt) < 3 * 86_400_000;
    const { returnPct } = scoreReturn({
      closes: closes[e.ticker.toUpperCase()] ?? [],
      flagDate: toYmd(e.priceAtFlagDate ?? e.createdAt),
      priceAtFlag: e.priceAtFlag,
      currentPrice: e.currentPrice,
    });
    const scored = tooNew ? null : returnPct;
    returnByEgg.set(e.id, scored);
    outcomes.push({ theme: rollupTheme(e.catalyst), confidence: e.confidence, returnPct: scored });
  }
  const cal = computeCalibration(outcomes);

  const tierWord = (h: number) => (h === 1 ? "first-tier" : h === 2 ? "second-tier" : "third-tier");
  const ranked = [...eggs]
    .map((e) => {
      const c = calibrate(e.confidence, cal.get(rollupTheme(e.catalyst)));
      const hopW = e.hopDistance === 1 ? 0.85 : e.hopDistance === 2 ? 1.0 : 1.1;
      return { e, score: c * (1 + e.noveltyScore) * hopW, calibrated: c };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_EGGS);

  const lines: string[] = [];
  lines.push(`GOLDEN EGGS (top ${ranked.length} of ${eggs.length} by rank; rank favours deeper tiers)`);
  for (const { e, calibrated } of ranked) {
    const r = returnByEgg.get(e.id);
    lines.push(
      `- ${e.ticker} (${e.companyName}) | ${tierWord(e.hopDistance)} | theme: ${rollupTheme(e.catalyst)} | ` +
        `model ${pct(e.confidence)} -> calibrated ${pct(calibrated)} | novelty ${pct(e.noveltyScore)} | ` +
        `${e.verified ? "web-verified" : "unverified"} | return since flagged: ${r == null ? "too new to score" : r.toFixed(1) + "%"}` +
        `\n    thesis: ${e.thesis.slice(0, 220)}`
    );
  }

  const calRows = [...cal.values()].sort((a, b) => b.n - a.n);
  if (calRows.length) {
    lines.push("", "THEME TRACK RECORD (realized, excludes picks too new to score)");
    for (const c of calRows) {
      lines.push(
        `- ${c.theme}: ${c.n} scored, ${pct(c.winRate)} of them up, model said ${pct(c.avgModelConfidence)}`
      );
    }
  }

  if (coattails.length) {
    lines.push("", "COATTAIL RIDERS (smaller names pulled by a bigger one, priced against it)");
    for (const c of coattails) {
      lines.push(
        `- ${c.riderTicker} (${c.riderName}) rides ${c.anchorTicker} | ${c.verdict}` +
          (c.premiumPct == null ? "" : ` by ${Math.abs(c.premiumPct).toFixed(0)}%`) +
          (c.sizeRatio ? ` | ~${Math.round(c.sizeRatio)}x smaller` : "") +
          (c.riderGrowthPct == null ? "" : ` | revenue ${c.riderGrowthPct.toFixed(0)}% YoY`) +
          `\n    link: ${c.linkage}`
      );
    }
  }

  const open = alerts.filter((a) => !a.acknowledgedAt);
  if (open.length) {
    lines.push("", "OPEN PRICE ALERTS");
    for (const a of open) {
      lines.push(`- ${a.ticker} moved ${a.returnPct.toFixed(1)}% since flagged (${a.direction})`);
    }
  }

  lines.push(
    "",
    "SYSTEM STATE",
    `- supply graph: ${nodes.length} nodes, ${edges.length} edges (grows itself from each scan's chains)`,
    `- user-approved custom themes: ${customThemes.map((c) => c.name).join(", ") || "none"}`,
    `- last scans: ${scans
      .map((s) => `#${s.id} ${s.eggsCreated} eggs / ${s.approxCredits} credits`)
      .join("; ")}`
  );

  return { text: lines.join("\n"), eggCount: eggs.length, asOf: Date.now() };
}
