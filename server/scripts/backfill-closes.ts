/**
 * Populate the daily-close cache over a long window.
 *
 * A CLI rather than the HTTP route because a deep backfill runs for tens of
 * minutes — Polygon's free tier allows ~5 requests/min, and this costs one
 * request per uncached trading day (covering every ticker at once). That's far
 * longer than any sane HTTP timeout.
 *
 * Free: quote data only, no credits.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-closes.ts            # default 45 days
 *   npx tsx server/scripts/backfill-closes.ts --days=180
 */
import "dotenv/config";
import { backfillCloses, candidateDays } from "../pipeline/closes";
import { storage } from "../storage";
import { candlesProvider, env } from "../config";

const arg = process.argv.find((a) => a.startsWith("--days="));
const days = arg ? Number(arg.split("=")[1]) : 45;

async function main() {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    console.error("--days must be an integer between 1 and 3650");
    process.exit(1);
  }

  const cached = new Set(await storage.listCachedCloseDates());
  const wanted = candidateDays(Date.now(), days);
  const todo = wanted.filter((d) => !cached.has(d));
  const mins = Math.ceil(todo.length / Math.max(1, env.POLYGON_RPM));

  console.log(`provider: ${candlesProvider} | rate limit: ~${env.POLYGON_RPM}/min`);
  console.log(`window: ${days} calendar days -> ${wanted.length} weekdays`);
  console.log(`already cached: ${wanted.length - todo.length} | to fetch: ${todo.length}`);
  console.log(`estimated: ~${mins} minute(s). Market holidays return no bars and are simply skipped.\n`);

  const started = Date.now();
  const r = await backfillCloses(days);
  const elapsed = Math.round((Date.now() - started) / 1000);

  console.log(
    `\ndone in ${elapsed}s — daysFetched=${r.daysFetched} daysSkipped=${r.daysSkipped} rowsWritten=${r.rowsWritten}`
  );
  const dates = await storage.listCachedCloseDates();
  const sorted = [...dates].sort();
  console.log(`cache now spans ${sorted.length} trading days: ${sorted[0]} -> ${sorted[sorted.length - 1]}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
