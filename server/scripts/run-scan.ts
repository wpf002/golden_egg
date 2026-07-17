/**
 * One-shot scan. Ingest -> classify -> analyze (cached) -> create eggs, then exit.
 *
 * This exists so scheduling can live in launchd rather than in-process:
 *   - node-cron only fires while the process is awake. A laptop asleep at 07:00
 *     silently loses that tick forever, and a missed scan day is a permanently
 *     missing cohort of eggs (RSS only serves recent items — you can't backfill
 *     a catalyst you never saw).
 *   - launchd's StartCalendarInterval runs a missed job when the machine wakes.
 *
 * It also needs no HTTP server, so it never fights `npm run dev` for the port.
 *
 * SPENDS CREDITS. Bounded per run by SCAN_MAX_CREDITS / SCAN_MAX_CATALYSTS.
 *
 * Usage: npx tsx server/scripts/run-scan.ts
 */
import "dotenv/config";
import { validateProviders } from "../config";
import { runFullScan, ScanInProgressError } from "../pipeline/scan";
import { log } from "../logger";

const logger = log("run-scan");

async function main() {
  // Fail loud on a missing key rather than burning the scheduled slot silently.
  validateProviders();

  try {
    const r = await runFullScan();
    logger.info({ ...r }, "scheduled scan complete");
    // The signal worth watching: cacheHits > 0 means the credit-saving
    // mechanism is doing its job on real, freshly-ingested catalysts.
    console.log(
      `scan ${r.runId}: ingested=${r.ingested} new=${r.new} themes=${r.themesAnalyzed} ` +
        `cacheHits=${r.cacheHits} eggs=${r.eggsCreated} credits=${r.approxCredits}`
    );
  } catch (e) {
    if (e instanceof ScanInProgressError) {
      // Another scan (manual, or an overlapping run) holds the slot. Not an error.
      logger.warn({ runId: e.runId }, "scan skipped — one already running");
      return;
    }
    throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    logger.error({ err: e }, "scheduled scan failed");
    process.exit(1);
  });
