/**
 * Backfill: canonicalize `sector`, preserving the model's original in
 * `sector_detail`.
 *
 * Eggs created before CANONICAL_SECTORS carry freeform sectors (46 distinct
 * values across 79 rows), which made sector rollups meaningless. This copies the
 * original into sector_detail and rewrites sector to the canonical bucket.
 *
 * Non-destructive: nothing is discarded, only moved. Idempotent — rows that
 * already have sector_detail are skipped, so re-running is safe.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-sectors.ts          # dry run
 *   npx tsx server/scripts/backfill-sectors.ts --apply
 */
import "dotenv/config";
import { sqlite } from "../storage";
import { coerceToSector } from "../pipeline/ripple-utils";

const APPLY = process.argv.includes("--apply");

type Row = { id: number; sector: string | null; sector_detail: string | null };

function main() {
  const rows = sqlite
    .prepare(`SELECT id, sector, sector_detail FROM golden_eggs WHERE sector_detail IS NULL`)
    .all() as Row[];

  console.log(`${rows.length} egg(s) need backfilling.`);
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to write)\n");
  if (rows.length === 0) return;

  const moves = new Map<string, number>();
  const update = sqlite.prepare(`UPDATE golden_eggs SET sector = ?, sector_detail = ? WHERE id = ?`);

  const run = sqlite.transaction((list: Row[]) => {
    for (const r of list) {
      const canonical = coerceToSector(r.sector);
      const key = `${r.sector ?? "(null)"} -> ${canonical}`;
      moves.set(key, (moves.get(key) ?? 0) + 1);
      if (APPLY) update.run(canonical, r.sector, r.id);
    }
  });
  run(rows);

  console.log("Mapping:");
  for (const [k, n] of [...moves.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(2)}  ${k}`);
  }

  const distinctBefore = new Set(rows.map((r) => r.sector ?? "(null)")).size;
  const distinctAfter = new Set(rows.map((r) => coerceToSector(r.sector))).size;
  console.log(`\nDistinct sectors: ${distinctBefore} -> ${distinctAfter}`);
  if (!APPLY) console.log("(dry run — nothing written)");
}

main();
process.exit(0);
