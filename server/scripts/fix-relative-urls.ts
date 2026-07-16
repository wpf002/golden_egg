/**
 * One-off: repair relative catalyst source URLs.
 *
 * Some RSS feeds (EIA) emit relative links like "/pressroom/releases/press587.php".
 * Ingest stored them raw, so the "source" link in the UI and in exports pointed
 * nowhere. ingest.ts now resolves links at write time (see resolveLink); this
 * fixes the rows written before that.
 *
 * Only rows whose feed can be identified unambiguously are touched — anything
 * else is reported and left alone rather than guessed at.
 *
 * Usage:
 *   npx tsx server/scripts/fix-relative-urls.ts          # dry run
 *   npx tsx server/scripts/fix-relative-urls.ts --apply
 */
import "dotenv/config";
import { sqlite } from "../storage";
import { resolveLink } from "../pipeline/ingest";

const APPLY = process.argv.includes("--apply");

/** Feed base per ingest theme — mirrors RSS_FEEDS in ingest.ts. */
const FEED_BY_THEME: Record<string, string> = {
  "monetary policy": "https://www.federalreserve.gov/feeds/press_all.xml",
  "energy policy": "https://www.energy.gov/rss.xml",
  "energy data": "https://www.eia.gov/rss/press_rss.xml",
  "US regulation": "https://www.federalregister.gov/api/v1/documents.rss",
  "trade & tariffs": "https://ustr.gov/about-us/policy-offices/press-office/press-releases/rss.xml",
  "labor economics": "https://www.bls.gov/feed/news_release/atus.rss",
  "defense procurement": "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx",
  "nuclear regulation": "https://www.nrc.gov/public-involve/public-meetings/schedule.rss",
  "drug approvals":
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
};

type Row = { id: number; theme: string; source_url: string };

function main() {
  const rows = sqlite
    .prepare(
      `SELECT id, theme, source_url FROM catalysts
        WHERE source_url IS NOT NULL AND source_url NOT LIKE 'http%'`
    )
    .all() as Row[];

  console.log(`${rows.length} catalyst(s) with a relative source URL.`);
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to write)\n");
  if (rows.length === 0) return;

  const update = sqlite.prepare(`UPDATE catalysts SET source_url = ? WHERE id = ?`);
  let fixed = 0;
  let skipped = 0;

  const run = sqlite.transaction((list: Row[]) => {
    for (const r of list) {
      const feed = FEED_BY_THEME[r.theme];
      if (!feed) {
        skipped++;
        console.log(`  id=${r.id} theme="${r.theme}" — unknown feed, LEFT UNCHANGED (${r.source_url})`);
        continue;
      }
      const resolved = resolveLink(r.source_url, feed);
      if (!resolved) {
        skipped++;
        console.log(`  id=${r.id} — unresolvable, LEFT UNCHANGED (${r.source_url})`);
        continue;
      }
      console.log(`  id=${r.id}: ${r.source_url} -> ${resolved}`);
      if (APPLY) update.run(resolved, r.id);
      fixed++;
    }
  });
  run(rows);

  console.log(`\n${APPLY ? "Fixed" : "Would fix"}: ${fixed} | skipped: ${skipped}`);
}

main();
process.exit(0);
