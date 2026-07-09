/**
 * The full scan: ingest -> classify -> analyze (cached) -> persist.
 * Callable from an API route or from a cron script.
 */
import { storage } from "../storage";
import { ingestSecEightK, ingestRss, ingestMarketSignals, persistCandidates, SCAN_THEMES } from "./ingest";
import { processCatalysts } from "./ripple";

export async function runFullScan() {
  const run = await storage.createScanRun({
    startedAt: Date.now(),
    finishedAt: null,
    catalystsIngested: 0,
    catalystsNew: 0,
    eggsCreated: 0,
    cacheHits: 0,
    approxCredits: 0,
    status: "running",
    errorMessage: null,
  });

  try {
    // 1. INGEST — cheap, structured, no LLM cost
    const [secCandidates, rssCandidates, marketCandidates] = await Promise.all([
      ingestSecEightK(SCAN_THEMES, 3),
      ingestRss(),
      ingestMarketSignals(),
    ]);
    const all = [...secCandidates, ...rssCandidates, ...marketCandidates];
    const { total, newCount } = await persistCandidates(all);

    // 2. Only NEW un-analyzed catalysts advance to reasoning
    const recent = await storage.listCatalysts(200);
    const unanalyzed = recent.filter((c) => !c.rippleAnalyzed).slice(0, 25); // cap per-scan cost

    // 3. Two-tier reasoning
    const stats = await processCatalysts(unanalyzed);

    await storage.finishScanRun(run.id, {
      finishedAt: Date.now(),
      catalystsIngested: total,
      catalystsNew: newCount,
      eggsCreated: stats.eggsCreated,
      cacheHits: stats.cacheHits,
      approxCredits: stats.approxCredits,
      status: "success",
    });

    return {
      runId: run.id,
      ingested: total,
      new: newCount,
      themesAnalyzed: stats.themesAnalyzed,
      cacheHits: stats.cacheHits,
      eggsCreated: stats.eggsCreated,
      approxCredits: stats.approxCredits,
    };
  } catch (e) {
    const msg = (e as Error).message;
    await storage.finishScanRun(run.id, {
      finishedAt: Date.now(),
      status: "error",
      errorMessage: msg,
    });
    throw e;
  }
}
