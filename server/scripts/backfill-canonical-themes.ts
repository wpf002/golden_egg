/**
 * Backfill `catalysts.canonical_theme` for catalysts that predate the column.
 *
 * Why it needs the LLM: the canonical theme was never persisted — it only ever
 * existed as a cache key — so it can't be recovered from the DB. Catalysts that
 * already produced eggs get re-classified so their eggs roll up under a real
 * theme instead of the source feed's label ("energy data").
 *
 * Cost: cheap-tier only, batched, and only for catalysts that actually have
 * eggs. Nothing here triggers premium ripple analysis.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-canonical-themes.ts          # dry run
 *   npx tsx server/scripts/backfill-canonical-themes.ts --apply
 */
import "dotenv/config";
import { sqlite, storage } from "../storage";
import { assignCanonicalThemes } from "../pipeline/ripple";
import type { Catalyst } from "@shared/schema";

const APPLY = process.argv.includes("--apply");
const BATCH = 12;

async function main() {
  // Only catalysts that produced eggs — the rest don't affect any rollup.
  const rows = sqlite
    .prepare(
      `SELECT c.* FROM catalysts c
        WHERE c.canonical_theme IS NULL
          AND EXISTS (SELECT 1 FROM golden_eggs e WHERE e.catalyst_id = c.id)
        ORDER BY c.id`
    )
    .all() as any[];

  const catalysts: Catalyst[] = rows.map((r) => ({
    id: r.id,
    contentHash: r.content_hash,
    title: r.title,
    summary: r.summary,
    theme: r.theme,
    canonicalTheme: r.canonical_theme,
    sourceType: r.source_type,
    sourceUrl: r.source_url,
    strengthScore: r.strength_score,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    rippleAnalyzed: !!r.ripple_analyzed,
    rippleCostCredits: r.ripple_cost_credits,
  }));

  console.log(`${catalysts.length} catalyst(s) with eggs need a canonical theme.`);
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to write)\n");
  if (catalysts.length === 0) return;

  let mapped = 0;
  let unmapped = 0;

  for (let i = 0; i < catalysts.length; i += BATCH) {
    const batch = catalysts.slice(i, i + BATCH);
    const themes = await assignCanonicalThemes(batch);
    for (const src of batch) {
      const theme = themes[src.id];
      if (!theme) {
        unmapped++;
        console.log(`  id=${src.id} "${src.theme}" -> (no canonical fit) LEFT NULL`);
        continue;
      }
      mapped++;
      console.log(`  id=${src.id} "${src.theme}" -> ${theme}`);
      if (APPLY) await storage.setCanonicalTheme(src.id, theme);
    }
  }

  console.log(`\n${APPLY ? "Mapped" : "Would map"}: ${mapped} | no canonical fit: ${unmapped}`);
  if (unmapped > 0) {
    console.log("Unmapped catalysts keep canonical_theme=NULL; rollups fall back to their feed label.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
