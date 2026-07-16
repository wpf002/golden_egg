/**
 * Daily-close cache.
 *
 * Why: Polygon's free tier allows ~5 requests/min. Fetching a per-ticker series
 * made the backtest take 10+ minutes for ~50 tickers — unusable. Grouped bars
 * return every US ticker for one day in ONE request, so we backfill by DAY and
 * read locally afterwards. Cost scales with days tracked, not tickers held.
 *
 * Backfilling 30 trading days ≈ 30 requests ≈ 6 minutes once, then the backtest
 * and sparklines are instant and free.
 */
import { storage } from "../storage";
import { getCandles } from "./providers/quotes";
import { log } from "../logger";

const logger = log("closes");

/** YYYY-MM-DD in UTC. */
export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Weekends never have bars; skip them rather than spend a request finding out. */
export function isWeekend(dateYmd: string): boolean {
  const day = new Date(dateYmd + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

/** Calendar days back from `endMs`, newest first, weekends removed. */
export function candidateDays(endMs: number, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = ymd(endMs - i * 86_400_000);
    if (!isWeekend(d)) out.push(d);
  }
  return out;
}

export type BackfillResult = { daysFetched: number; daysSkipped: number; rowsWritten: number };

/**
 * Populate the cache for the last `days` calendar days.
 *
 * Only tickers we actually track are stored — the grouped response covers
 * ~12k symbols and we have no use for the rest. Days already cached are
 * skipped, so this is cheap to re-run (and safe to schedule daily).
 */
export async function backfillCloses(days = 40, endMs = Date.now()): Promise<BackfillResult> {
  const provider = getCandles();
  if (!provider.groupedCloses) {
    logger.warn("candles provider has no grouped endpoint — skipping backfill");
    return { daysFetched: 0, daysSkipped: 0, rowsWritten: 0 };
  }

  const tracked = new Set((await storage.listAllEggs()).map((e) => e.ticker.trim().toUpperCase()));
  if (tracked.size === 0) return { daysFetched: 0, daysSkipped: 0, rowsWritten: 0 };

  const cached = new Set(await storage.listCachedCloseDates());
  const wanted = candidateDays(endMs, days);

  let daysFetched = 0;
  let daysSkipped = 0;
  let rowsWritten = 0;

  for (const date of wanted) {
    if (cached.has(date)) {
      daysSkipped++;
      continue;
    }
    const all = await provider.groupedCloses(date);
    if (all === null) continue; // request failed; already logged
    daysFetched++;
    const rows = Object.entries(all)
      .filter(([sym]) => tracked.has(sym))
      .map(([ticker, close]) => ({ ticker, date, close }));
    // A market holiday returns no bars and so caches nothing — it'll be retried
    // on the next run. That's ~1-2 wasted requests per backfill, which is
    // cheaper than a sentinel-row scheme to remember "this day was empty".
    if (rows.length > 0) rowsWritten += await storage.putDailyCloses(rows);
  }

  logger.info({ daysFetched, daysSkipped, rowsWritten, tickers: tracked.size }, "closes backfill complete");
  return { daysFetched, daysSkipped, rowsWritten };
}
