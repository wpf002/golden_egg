/**
 * The full scan: ingest -> classify -> analyze (cached) -> persist.
 * Callable from an API route or from a scheduled task.
 */
import { storage } from "../storage";
import { ingestSecEightK, ingestRss, ingestMarketSignals, persistCandidates, SCAN_THEMES } from "./ingest";
import { processCatalysts } from "./ripple";
import { env } from "../config";
import { log } from "../logger";

const logger = log("scan");

/** A scan is considered abandoned after this long without completing. */
const STALE_RUN_MS = 30 * 60_000;

/** Thrown when a scan is already in flight. Routes map this to HTTP 409. */
export class ScanInProgressError extends Error {
  constructor(
    public readonly runId: number,
    public readonly startedAt: number
  ) {
    super("A scan is already running");
    this.name = "ScanInProgressError";
  }
}

export async function runFullScan() {
  // Concurrency guard: scans cost credits, so never let two run at once.
  const claim = await storage.tryStartScanRun(Date.now(), STALE_RUN_MS);
  if (!claim.ok) {
    logger.warn({ runId: claim.running.id }, "scan rejected — one already running");
    throw new ScanInProgressError(claim.running.id, claim.running.startedAt);
  }
  const run = claim.run;
  logger.info(
    { runId: run.id, maxCatalysts: env.SCAN_MAX_CATALYSTS, maxCredits: env.SCAN_MAX_CREDITS },
    "scan started"
  );

  try {
    // 1. INGEST — cheap, structured, no LLM cost
    const [secCandidates, rssCandidates, marketCandidates] = await Promise.all([
      ingestSecEightK(SCAN_THEMES, 3),
      ingestRss(),
      ingestMarketSignals(),
    ]);
    const all = [...secCandidates, ...rssCandidates, ...marketCandidates];
    const { total, newCount } = await persistCandidates(all);
    logger.info({ runId: run.id, ingested: total, new: newCount }, "ingest complete");

    // 2. Only NEW un-analyzed catalysts advance to reasoning
    const recent = await storage.listCatalysts(200);
    const eligible = recent.filter((c) => !c.rippleAnalyzed);
    const unanalyzed = eligible.slice(0, env.SCAN_MAX_CATALYSTS);
    if (eligible.length > unanalyzed.length) {
      logger.info(
        { runId: run.id, deferred: eligible.length - unanalyzed.length, cap: env.SCAN_MAX_CATALYSTS },
        "per-run catalyst cap hit — remainder deferred to the next scan"
      );
    }

    // 3. Two-tier reasoning, bounded by the credit ceiling
    const stats = await processCatalysts(unanalyzed, env.SCAN_MAX_CREDITS);

    await storage.finishScanRun(run.id, {
      finishedAt: Date.now(),
      catalystsIngested: total,
      catalystsNew: newCount,
      eggsCreated: stats.eggsCreated,
      cacheHits: stats.cacheHits,
      approxCredits: stats.approxCredits,
      status: "success",
    });
    logger.info(
      {
        runId: run.id,
        eggsCreated: stats.eggsCreated,
        themesAnalyzed: stats.themesAnalyzed,
        cacheHits: stats.cacheHits,
        approxCredits: stats.approxCredits,
      },
      "scan complete"
    );

    return {
      runId: run.id,
      ingested: total,
      new: newCount,
      themesAnalyzed: stats.themesAnalyzed,
      cacheHits: stats.cacheHits,
      eggsCreated: stats.eggsCreated,
      approxCredits: stats.approxCredits,
      budgetExhausted: stats.budgetExhausted,
    };
  } catch (e) {
    const msg = (e as Error).message;
    logger.error({ runId: run.id, err: e }, "scan failed");
    await storage.finishScanRun(run.id, {
      finishedAt: Date.now(),
      status: "error",
      errorMessage: msg,
    });
    throw e;
  }
}
