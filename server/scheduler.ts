/**
 * Recurring background tasks.
 *
 * Two jobs:
 *   1. A recurring scan (opt-in via SCAN_SCHEDULE — the app originally ran a
 *      daily pre-market scan). Disabled by default: scans cost credits, so
 *      nobody should get billed by merely starting the server.
 *   2. A cache sweep that evicts expired ripple-cache rows. `expiresAt` was
 *      previously only honoured on read, so dead rows accumulated forever.
 *
 * Both are safe to run alongside manual triggers: the scan goes through the
 * same concurrency guard as the API route and simply backs off if one is
 * already in flight.
 */
import cron, { type ScheduledTask } from "node-cron";
import { env } from "./config";
import { storage } from "./storage";
import { runFullScan, ScanInProgressError } from "./pipeline/scan";
import { log } from "./logger";

const logger = log("scheduler");

const tasks: ScheduledTask[] = [];

export function startScheduledTasks(): void {
  // ---- Recurring scan (opt-in) ----
  if (env.SCAN_SCHEDULE) {
    if (!cron.validate(env.SCAN_SCHEDULE)) {
      throw new Error(
        `SCAN_SCHEDULE is not a valid schedule expression: "${env.SCAN_SCHEDULE}". ` +
          `Use 5 fields, e.g. "30 13 * * 1-5" for weekdays at 13:30.`
      );
    }
    tasks.push(
      cron.schedule(env.SCAN_SCHEDULE, async () => {
        try {
          logger.info("scheduled scan starting");
          const r = await runFullScan();
          logger.info({ ...r }, "scheduled scan complete");
        } catch (e) {
          if (e instanceof ScanInProgressError) {
            logger.warn({ runId: e.runId }, "scheduled scan skipped — a scan is already running");
            return;
          }
          // Never rethrow from a scheduled callback: an unhandled rejection here
          // would take down the server.
          logger.error({ err: e }, "scheduled scan failed");
        }
      })
    );
    logger.info({ schedule: env.SCAN_SCHEDULE }, "recurring scan enabled");
  } else {
    logger.info("recurring scan disabled (set SCAN_SCHEDULE to enable)");
  }

  // ---- Cache sweep ----
  const sweepMinutes = env.CACHE_SWEEP_MINUTES;
  const sweepExpr =
    sweepMinutes >= 60 ? `0 */${Math.floor(sweepMinutes / 60)} * * *` : `*/${sweepMinutes} * * * *`;
  if (cron.validate(sweepExpr)) {
    tasks.push(
      cron.schedule(sweepExpr, async () => {
        try {
          const removed = await storage.sweepExpiredCache(Date.now());
          if (removed > 0) logger.info({ removed }, "expired ripple-cache rows swept");
        } catch (e) {
          logger.error({ err: e }, "cache sweep failed");
        }
      })
    );
    logger.info({ schedule: sweepExpr }, "cache sweep enabled");
  } else {
    logger.warn({ sweepExpr }, "computed cache-sweep schedule is invalid — sweep disabled");
  }
}

/** Stop all scheduled tasks (used on shutdown). */
export function stopScheduledTasks(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
