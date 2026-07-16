/**
 * One-off repair for corrupt `priceAtFlag` values.
 *
 * Some legacy eggs carry a placeholder flag price ($1/$2 against a $1,000+
 * stock), which renders as a five-figure "return". Those rows predate this
 * codebase — the seed writes NULL, so the values came from an early import.
 *
 * The repair looks up the *actual* daily close on each egg's flag date and
 * writes that back. That needs a candles-capable provider (CANDLES_PROVIDER=
 * polygon): without one we'd have to reset the flag price to today's, which
 * would silently erase the position's real history. So if candles are
 * unavailable this script reports and changes nothing, rather than doing the
 * lossy thing quietly.
 *
 * Usage:
 *   npx tsx server/scripts/repair-flag-prices.ts          # dry run (default)
 *   npx tsx server/scripts/repair-flag-prices.ts --apply  # write changes
 */
import "dotenv/config";
import { sqlite } from "../storage";
import { fetchDailyCloses, toYmd } from "../pipeline/finance";
import { candlesProvider } from "../config";

const APPLY = process.argv.includes("--apply");

/** A return this extreme can't be a real move — the flag price is bad. */
const SUSPECT_RETURN_PCT = 1000;

type Row = {
  id: number;
  ticker: string;
  price_at_flag: number;
  current_price: number;
  price_at_flag_date: number | null;
  created_at: number;
};

async function main() {
  const rows = sqlite
    .prepare(
      `SELECT id, ticker, price_at_flag, current_price, price_at_flag_date, created_at
         FROM golden_eggs
        WHERE price_at_flag IS NOT NULL AND price_at_flag > 0 AND current_price IS NOT NULL
          AND ABS(((current_price - price_at_flag) / price_at_flag) * 100) > ?`
    )
    .all(SUSPECT_RETURN_PCT) as Row[];

  console.log(`Found ${rows.length} egg(s) with an implausible return (bad flag price).`);
  if (rows.length === 0) return;

  console.log(`Candles provider: ${candlesProvider}`);
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to write)\n");

  let repaired = 0;
  let unresolved = 0;

  for (const r of rows) {
    const flagTs = r.price_at_flag_date ?? r.created_at;
    const flagDay = toYmd(flagTs);
    // Widen the window: the flag date may be a weekend/holiday with no close.
    const from = toYmd(flagTs - 7 * 86_400_000);
    const closes = await fetchDailyCloses(r.ticker, from, flagDay);
    const trueClose = closes.length ? closes[closes.length - 1] : null;

    if (!trueClose) {
      unresolved++;
      console.log(`  ${r.ticker} (id=${r.id}): no close found for ${flagDay} — LEFT UNCHANGED`);
      continue;
    }

    const newRet = ((r.current_price - trueClose.close) / trueClose.close) * 100;
    console.log(
      `  ${r.ticker} (id=${r.id}): flag $${r.price_at_flag} -> $${trueClose.close} (${trueClose.date}) ` +
        `| return ${newRet.toFixed(1)}%`
    );

    if (APPLY) {
      sqlite
        .prepare(`UPDATE golden_eggs SET price_at_flag = ?, price_at_flag_date = ? WHERE id = ?`)
        .run(trueClose.close, new Date(trueClose.date + "T00:00:00Z").getTime(), r.id);
      repaired++;
    }
  }

  console.log(
    `\n${APPLY ? "Repaired" : "Would repair"}: ${APPLY ? repaired : rows.length - unresolved} | unresolved: ${unresolved}`
  );
  if (unresolved > 0) {
    console.log(
      "Unresolved rows kept their (bad) flag price. They stay excluded from scoring by the\n" +
        "suspect-return guard, so nothing shows a fake win either way."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
