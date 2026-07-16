/**
 * Markdown report of the top eggs — pasteable into Notion, a doc, or an email.
 *
 * Pure rendering over data already in hand: no network, no credits.
 */
import type { GoldenEggWithCatalyst } from "@shared/schema";
import { scoreReturn } from "./backtest";

/** Return-vs-flag with the corrupt-flag-price guard (reuses the backtest rules). */
function ret(priceAtFlag: number | null, currentPrice: number | null) {
  return scoreReturn({ closes: [], flagDate: "", priceAtFlag, currentPrice });
}

export type ReportOptions = {
  topN: number;
  /** Only include eggs flagged within this many days. */
  sinceDays?: number;
  /** Injectable for deterministic tests. */
  now?: number;
};

/** Rank by conviction × non-obviousness — the app's whole thesis. */
function score(e: GoldenEggWithCatalyst): number {
  return e.confidence * (1 + (e.noveltyScore ?? 0.5));
}

function fmtPrice(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

export function renderMarkdownReport(eggs: GoldenEggWithCatalyst[], opts: ReportOptions): string {
  const now = opts.now ?? Date.now();
  const cutoff = opts.sinceDays ? now - opts.sinceDays * 86_400_000 : null;

  const pool = cutoff ? eggs.filter((e) => (e.priceAtFlagDate ?? e.createdAt) >= cutoff) : eggs;
  const top = [...pool].sort((a, b) => score(b) - score(a)).slice(0, opts.topN);

  const date = new Date(now).toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Golden Egg — top parallel plays`);
  lines.push("");
  lines.push(`_Generated ${date}${opts.sinceDays ? ` · flagged in the last ${opts.sinceDays} days` : ""}._`);
  lines.push("");

  if (top.length === 0) {
    lines.push("No eggs match the current filter.");
    lines.push("");
    return lines.join("\n");
  }

  // Summary table
  lines.push(`| # | Ticker | Company | Sector | Hop | Conf | Novelty | Flag | Current | Return |`);
  lines.push(`|---|--------|---------|--------|-----|------|---------|------|---------|--------|`);
  top.forEach((e, i) => {
    const { returnPct, suspect } = ret(e.priceAtFlag, e.currentPrice);
    const retCell = suspect
      ? "n/a*"
      : returnPct == null
        ? "—"
        : `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`;
    lines.push(
      `| ${i + 1} | **${e.ticker}** | ${e.companyName} | ${e.sector ?? "—"} | ${e.hopDistance} | ` +
        `${(e.confidence * 100).toFixed(0)}% | ${((e.noveltyScore ?? 0.5) * 100).toFixed(0)}% | ` +
        `${fmtPrice(e.priceAtFlag)} | ${fmtPrice(e.currentPrice)} | ${retCell} |`
    );
  });
  lines.push("");

  const anySuspect = top.some((e) => ret(e.priceAtFlag, e.currentPrice).suspect);
  if (anySuspect) {
    lines.push(`\\* Return withheld — the recorded flag price for that egg looks corrupt.`);
    lines.push("");
  }

  // Theses
  lines.push(`## Theses`);
  lines.push("");
  top.forEach((e, i) => {
    lines.push(`### ${i + 1}. ${e.ticker} — ${e.companyName}`);
    lines.push("");
    lines.push(
      `- **Sector:** ${e.sectorDetail || e.sector || "—"} · **Hop:** ${e.hopDistance} · **Timing:** ${e.timingLag}`
    );
    lines.push(
      `- **Catalyst:** ${e.catalyst.title}${e.catalyst.sourceUrl ? ` ([source](${e.catalyst.sourceUrl}))` : ""}`
    );
    const path = parsePath(e.ripplePath);
    if (path.length) lines.push(`- **Ripple:** ${path.map((p) => p.node).join(" → ")}`);
    lines.push("");
    lines.push(e.thesis);
    lines.push("");
  });

  lines.push(`---`);
  lines.push("");
  lines.push(`_${top.length} of ${pool.length} eggs. Not investment advice._`);
  lines.push("");
  return lines.join("\n");
}

function parsePath(raw: string | null): Array<{ node: string }> {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
