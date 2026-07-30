/**
 * Coattail discovery — smaller companies whose growth is pulled along by a
 * giant, priced against that giant.
 *
 * The eggs pipeline starts from a news catalyst. This starts from a COMPANY,
 * which is a different question: "everyone watches NVIDIA — who grows because
 * NVIDIA grows, is small enough that it still matters to them, and how is that
 * priced today?"
 *
 * Division of labour is deliberate:
 *   - the model proposes WHO rides whom and HOW the money flows (judgement)
 *   - the provider's reported figures decide cheap vs expensive (arithmetic)
 * The model is never asked what something is worth — only what connects to
 * what. That keeps the valuation verdict falsifiable.
 */
import { storage } from "../storage";
import { getLlm } from "./providers/llm";
import { getQuotes } from "./providers/quotes";
import { extractJson } from "./ripple-utils";
import { compareValuation, sizeRatio, describeComparison, type Fundamentals } from "../lib/valuation";
import { namesLookAlike } from "../lib/company-name";
import { log } from "../logger";

const logger = log("coattails");

/** Per-run ceiling on proposals, so one call can't stampede the quote budget. */
const MAX_RIDERS_PER_ANCHOR = 6;

export type RiderProposal = {
  ticker: string;
  company_name: string;
  thesis: string;
  linkage: string;
  novelty: number;
};

/** Pure: validate the model's rider list. */
export function parseRiders(parsed: unknown, anchorTicker: string): RiderProposal[] {
  const raw = ((parsed as { riders?: unknown })?.riders ?? []) as Array<Record<string, unknown>>;
  const out: RiderProposal[] = [];
  const seen = new Set<string>([anchorTicker.toUpperCase()]);
  for (const r of raw) {
    const ticker = String(r.ticker ?? "")
      .trim()
      .toUpperCase();
    const company_name = String(r.company_name ?? "").trim();
    const thesis = String(r.thesis ?? "").trim();
    const linkage = String(r.linkage ?? "").trim();
    // A rider with no ticker can't be priced, and one that IS the anchor is
    // circular — both are worse than a shorter list.
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) continue;
    if (seen.has(ticker)) continue;
    if (company_name.length < 2 || thesis.length < 20 || linkage.length < 10) continue;
    seen.add(ticker);
    const novelty = Number(r.novelty);
    out.push({
      ticker,
      company_name,
      thesis: thesis.slice(0, 600),
      linkage: linkage.slice(0, 300),
      novelty: Number.isFinite(novelty) ? Math.min(1, Math.max(0, novelty)) : 0.5,
    });
    if (out.length >= MAX_RIDERS_PER_ANCHOR) break;
  }
  return out;
}

async function proposeRiders(anchorTicker: string, anchorName: string): Promise<RiderProposal[]> {
  const prompt = `${anchorName} (${anchorTicker}) is a large, widely-followed company. Find SMALLER US-listed companies whose growth is genuinely pulled along by it.

What counts:
  - it sells into ${anchorTicker}, or into the buildout ${anchorTicker}'s growth forces
  - it is a real beneficiary of ${anchorTicker}'s spending, capacity or ecosystem
  - it is materially smaller than ${anchorTicker}, so that pull still moves its numbers

What does NOT count:
  - direct competitors, or peers of similar size
  - household names already discussed alongside ${anchorTicker} every day
  - vague "exposure to the sector" with no specific commercial link

For each, give:
  - ticker: US-listed. Omit the row if you are not certain the ticker is right.
  - company_name: the legal name
  - thesis: 1-2 sentences, plain English, no jargon. Say what the company does and why ${anchorTicker}'s growth reaches it.
  - linkage: one short phrase naming the actual mechanism (e.g. "supplies interconnect chips into its GPU racks")
  - novelty: 0-1, higher when fewer investors have made this connection

Return AT MOST ${MAX_RIDERS_PER_ANCHOR}. Fewer good ones beats padding.
Return ONLY JSON: {"riders":[{"ticker":"...","company_name":"...","thesis":"...","linkage":"...","novelty":0.7}]}`;

  // 3000 was not enough: a premium reply came back capped with ZERO text
  // characters, so nothing could be parsed after paying for the call. The
  // egg pipeline settled on 8000 for the same reason.
  const text = await getLlm().complete(prompt, { tier: "premium", maxTokens: 8000 });
  return parseRiders(extractJson(text), anchorTicker);
}

async function fundamentalsFor(ticker: string): Promise<Fundamentals | null> {
  const provider = getQuotes();
  if (!provider.fundamentals) return null;
  const f = await provider.fundamentals(ticker);
  if (!f) return null;
  return { ticker, ...f };
}

export type CoattailScanResult = {
  anchor: string;
  proposed: number;
  saved: number;
  skipped: number;
};

/**
 * Find and price the riders behind one anchor. Existing pairs are refreshed
 * rather than duplicated, so re-running keeps the numbers current.
 */
export async function scanAnchor(anchorTicker: string): Promise<CoattailScanResult> {
  const ticker = anchorTicker.trim().toUpperCase();
  const provider = getQuotes();
  const anchorName = (provider.companyName ? await provider.companyName(ticker) : null) ?? ticker;

  const anchorF = await fundamentalsFor(ticker);
  const riders = await proposeRiders(ticker, anchorName);
  const result: CoattailScanResult = { anchor: ticker, proposed: riders.length, saved: 0, skipped: 0 };
  if (riders.length === 0) return result;

  const now = Date.now();
  for (const r of riders) {
    // Same guard the eggs pipeline uses: a real ticker paired with the wrong
    // company name means the model hallucinated one of the two.
    const official = provider.companyName ? await provider.companyName(r.ticker) : null;
    if (official && !namesLookAlike(r.company_name, official)) {
      logger.info(
        { ticker: r.ticker, proposed: r.company_name, official },
        "coattail name mismatch — skipped"
      );
      result.skipped++;
      continue;
    }
    const riderF = await fundamentalsFor(r.ticker);
    if (!riderF) {
      result.skipped++;
      continue;
    }
    const cmp = anchorF
      ? compareValuation(riderF, anchorF)
      : { verdict: "unknown" as const, riderRatio: null, anchorRatio: null, premiumPct: null };
    const size = anchorF ? sizeRatio(riderF, anchorF) : null;

    await storage.upsertCoattailPick({
      riderTicker: r.ticker,
      riderName: official || r.company_name,
      anchorTicker: ticker,
      anchorName,
      thesis: r.thesis,
      linkage: r.linkage,
      verdict: cmp.verdict,
      riderRatio: cmp.riderRatio,
      anchorRatio: cmp.anchorRatio,
      premiumPct: cmp.premiumPct,
      sizeRatio: size,
      riderMarketCapM: riderF.marketCapM,
      riderGrowthPct: riderF.revenueGrowthPct,
      riderPriceToSales: riderF.priceToSales,
      noveltyScore: r.novelty,
      discoveredAt: now,
      refreshedAt: now,
    });
    result.saved++;
  }
  logger.info(result, "coattail scan complete");
  return result;
}

/**
 * Anchors worth scanning, derived from the app's own data: the tickers that
 * show up most often as the LARGE end of a chain. Falls back to nothing rather
 * than a hardcoded list — the app should follow what it's actually tracking.
 */
export async function suggestAnchors(limit = 5): Promise<string[]> {
  const nodes = await storage.listNodes();
  const edges = await storage.listAllEdges();
  const outdeg = new Map<number, number>();
  for (const e of edges) outdeg.set(e.fromNodeId, (outdeg.get(e.fromNodeId) ?? 0) + 1);
  return nodes
    .filter((n) => n.ticker && outdeg.has(n.id))
    .sort((a, b) => (outdeg.get(b.id) ?? 0) - (outdeg.get(a.id) ?? 0))
    .slice(0, limit)
    .map((n) => n.ticker!.toUpperCase());
}

export { describeComparison };
