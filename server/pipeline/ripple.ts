/**
 * Ripple Reasoning v2 \u2014 two-tier LLM with tighter cost controls.
 *
 * v2 changes:
 *   - Classifier is forced to pick a normalized_theme from CANONICAL_THEMES
 *     enum. Massively improves cache-hit ratio.
 *   - Graph context is filtered by BFS from theme-relevant seed nodes
 *     rather than dumping all edges into every premium call.
 *   - Graph nodes/edges are memoized module-scope; refresh every 60s.
 *   - Cache entries carry a 30-day TTL. Expired entries trigger a refresh.
 *   - Egg creation captures priceAtFlag via the finance connector.
 */
import crypto from "node:crypto";
import { storage } from "../storage";
import { CANONICAL_THEMES } from "@shared/schema";
import type { Catalyst, Node as GraphNode, Edge as GraphEdge } from "@shared/schema";
import { fetchQuotes } from "./finance";
import { getLlm } from "./providers/llm";
import { env } from "../config";
import { coerceToCanonical, extractJson, coerceToSector, themeFromId } from "./ripple-utils";
import { groundEggs, applyGrounding } from "./grounding";
import { namesLookAlike } from "../lib/company-name";
import { getQuotes } from "./providers/quotes";
import { log } from "../logger";

const logger = log("ripple");

// Re-exported for callers/tests that import them from the pipeline entrypoint.
export { coerceToCanonical, extractJson, coerceToSector };

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const themeHash = (s: string) =>
  crypto.createHash("sha256").update(s.toLowerCase().trim()).digest("hex").slice(0, 24);

// ---------------------------------------------------------------
// Graph memoization \u2014 refresh at most once every 60s.
// ---------------------------------------------------------------
let _graphCache: { nodes: GraphNode[]; edges: GraphEdge[]; ts: number } | null = null;
async function getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const now = Date.now();
  if (_graphCache && now - _graphCache.ts < 60_000) return _graphCache;
  const [nodes, edges] = await Promise.all([storage.listNodes(), storage.listAllEdges()]);
  _graphCache = { nodes, edges, ts: now };
  return { nodes, edges };
}

// ---------------------------------------------------------------
// TIER 1 \u2014 batch classify with canonical theme enum
// ---------------------------------------------------------------
export type ClassifiedCatalyst = {
  catalyst_id: number;
  keep: boolean;
  normalized_theme: string;
  strength: number;
  rationale: string;
};

/**
 * The classifier's vocabulary: compiled canonical themes plus any the user has
 * approved from scout proposals. Order is stable (canonical first, customs in
 * creation order) so the numeric theme_id protocol stays unambiguous.
 */
export async function activeThemes(): Promise<string[]> {
  const custom = await storage.listCustomThemes();
  return [...CANONICAL_THEMES, ...custom.map((c) => c.name)];
}

export async function classifyCatalysts(catalysts: Catalyst[]): Promise<ClassifiedCatalyst[]> {
  if (catalysts.length === 0) return [];
  const items = catalysts.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 200),
    theme: c.theme,
    summary: c.summary.slice(0, 250),
  }));

  const themes = await activeThemes();
  const themeList = themes.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `You are triaging market catalysts for a parallel-market ("picks and shovels") equity screener.

For EACH item below decide:
  keep: true only if this represents a MATERIAL, ripple-generating shift (secular demand, regulation, tech adoption, supply shock). Reject vague news, single-quarter noise, company-specific PR, minor executive changes, personnel changes, dividend declarations, buybacks, share splits, quarterly-only earnings reactions.
  theme_id: the NUMBER of exactly one theme from the CANONICAL LIST below. Do NOT write a theme name, and do NOT invent one \u2014 return the number. If no listed theme genuinely fits, set keep=false and theme_id=0.
  strength: 0-1. How large is the second-order economic ripple?
  rationale: one short sentence.

CANONICAL THEMES (return the NUMBER):
${themeList}

Items:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON object of shape: { "results": [{ "catalyst_id": N, "keep": bool, "theme_id": N, "strength": 0.x, "rationale": "..." }] }`;

  try {
    const text = await getLlm().complete(prompt, { tier: "cheap", maxTokens: 2000 });
    const parsed = extractJson(text);
    const results = (parsed?.results ?? []) as Array<Record<string, unknown>>;
    return results.map((r) => {
      // Prefer the numeric id \u2014 it either indexes the list or it doesn't, so
      // there's no room for the drift that kept the cache at a 0% hit rate.
      // Fall back to the string form for older/looser model output.
      const theme =
        themeFromId(r.theme_id, themes) || coerceToCanonical(String(r.normalized_theme ?? ""), themes);
      return {
        catalyst_id: Number(r.catalyst_id),
        // No canonical theme => not something we track. Rejecting beats minting
        // a one-off cache key that can never be hit again.
        keep: r.keep !== false && theme !== "",
        normalized_theme: theme,
        strength: Number.isFinite(r.strength) ? (r.strength as number) : 0.3,
        rationale: String(r.rationale ?? ""),
      } satisfies ClassifiedCatalyst;
    });
  } catch (e) {
    logger.warn({ err: e, count: catalysts.length }, "classifyCatalysts failed — rejecting batch");
    return catalysts.map((c) => ({
      catalyst_id: c.id,
      keep: false,
      normalized_theme: c.theme,
      strength: 0.3,
      rationale: "classifier error",
    }));
  }
}

/**
 * Ask only "which canonical theme is this?", with no keep/reject judgement.
 *
 * classifyCatalysts deliberately couples the two \u2014 a rejected catalyst needs no
 * theme. That coupling is wrong for backfilling existing catalysts: they already
 * produced eggs, so the question isn't whether to keep them, it's what to file
 * them under. Asked together, the model zeroes the theme whenever it decides
 * "not material", and the rollup learns nothing.
 *
 * Cheap tier, batched. Returns { catalystId: canonicalTheme } for the ones it
 * could place.
 */
export async function assignCanonicalThemes(catalysts: Catalyst[]): Promise<Record<number, string>> {
  if (catalysts.length === 0) return {};
  const items = catalysts.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 200),
    summary: c.summary.slice(0, 250),
  }));
  const themes = await activeThemes();
  const themeList = themes.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `Classify each market catalyst under the single best-fitting theme.

This is a filing exercise, NOT a quality judgement \u2014 do not consider whether the
catalyst is important, material, or tradable. Only: which theme does it belong to?

THEMES (return the NUMBER):
${themeList}

For each item return theme_id: the number of the best-fitting theme, or 0 ONLY if
genuinely none of them relate to the subject matter.

Items:
${JSON.stringify(items, null, 2)}

Return ONLY JSON: { "results": [{ "catalyst_id": N, "theme_id": N }] }`;

  try {
    const text = await getLlm().complete(prompt, { tier: "cheap", maxTokens: 1500 });
    const parsed = extractJson(text);
    const out: Record<number, string> = {};
    for (const r of (parsed?.results ?? []) as Array<Record<string, unknown>>) {
      const theme = themeFromId(r.theme_id, themes);
      const id = Number(r.catalyst_id);
      if (theme && Number.isInteger(id)) out[id] = theme;
    }
    return out;
  } catch (e) {
    logger.warn({ err: e, count: catalysts.length }, "assignCanonicalThemes failed");
    return {};
  }
}

// ---------------------------------------------------------------
// TIER 2 \u2014 filtered graph context by BFS from theme-relevant seeds
// ---------------------------------------------------------------
export type RippleOutput = {
  eggs: Array<{
    ticker: string;
    company_name: string;
    thesis: string;
    hop_distance: 1 | 2 | 3;
    confidence: number;
    novelty_score: number;
    timing_lag: "leading" | "concurrent" | "lagging";
    sector: string;
    ripple_path: Array<{ node: string; relation: string }>;
    /** Set by web grounding: a search-backed check supported this thesis. */
    verified?: boolean;
  }>;
};

/**
 * BFS out to depth 3 from seed nodes whose name/description matches theme tokens.
 * Returns a compact edge summary that fits comfortably in the premium prompt.
 */
async function filteredGraphForTheme(theme: string): Promise<string> {
  const { nodes, edges } = await getGraph();
  const themeTokens = theme
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const seedIds = new Set<number>();
  for (const n of nodes) {
    const hay = (n.name + " " + (n.description || "") + " " + n.slug).toLowerCase();
    if (themeTokens.some((t) => hay.includes(t))) seedIds.add(n.id);
  }
  // BFS depth 3 following outgoing edges
  const edgesFrom = new Map<number, GraphEdge[]>();
  for (const e of edges) {
    if (!edgesFrom.has(e.fromNodeId)) edgesFrom.set(e.fromNodeId, []);
    edgesFrom.get(e.fromNodeId)!.push(e);
  }
  const visited = new Set<number>(seedIds);
  const keptEdges: GraphEdge[] = [];
  let frontier = Array.from(seedIds);
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      const outs = edgesFrom.get(id) || [];
      for (const e of outs) {
        keptEdges.push(e);
        if (!visited.has(e.toNodeId)) {
          visited.add(e.toNodeId);
          next.push(e.toNodeId);
        }
      }
    }
    frontier = next;
  }
  // Cap to protect prompt size
  const capped = keptEdges.slice(0, 60);
  const byId = new Map<number, GraphNode>(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  for (const e of capped) {
    const from = byId.get(e.fromNodeId);
    const to = byId.get(e.toNodeId);
    if (!from || !to) continue;
    const toStr = to.ticker ? `${to.name} (${to.ticker})` : to.name;
    lines.push(
      `  ${from.name} --[${e.relation}, s=${e.strength.toFixed(2)}]--> ${toStr}${e.note ? ` (${e.note})` : ""}`
    );
  }
  const scope =
    seedIds.size > 0 ? `filtered from ${seedIds.size} theme-relevant seeds` : "unfiltered fallback";
  return `Known supply-chain edges (${lines.length} shown, ${scope}, total ${edges.length}):\n${lines.join("\n") || "  (no matching subgraph \u2014 reason from your own knowledge)"}`;
}

export async function analyzeTheme(theme: string, themeSummary: string): Promise<RippleOutput> {
  const graphContext = await filteredGraphForTheme(theme);

  const prompt = `You are a supply-chain equity analyst focused on PARALLEL and ANCILLARY beneficiaries \u2014 the picks-and-shovels 2nd- and 3rd-order plays that most investors miss.

CATALYST THEME: ${theme}
SUMMARY: ${themeSummary}

USE THIS KNOWLEDGE GRAPH (extend it with your own reasoning, but respect these edges):
${graphContext}

TASK:
Identify 4\u20138 PUBLICLY-TRADED US-listed tickers (equities, ADRs, or ETFs) that would benefit from this catalyst. For each:
  - Skip the OBVIOUS direct plays (e.g. for AI, skip NVDA \u2014 everyone owns it). Prioritize NON-OBVIOUS 2nd/3rd-order beneficiaries.
  - hop_distance: 1 = direct supplier, 2 = supplier's supplier, 3 = 3rd-order
  - confidence: 0-1. Downgrade if the link is speculative or the ticker is illiquid/thinly-followed
  - novelty_score: 0-1. Higher = less obvious/less crowded (0.7+ preferred)
  - timing_lag: leading = benefits before mainstream notices; concurrent = benefits in current cycle; lagging = benefits later
  - ripple_path: chain of nodes from catalyst to ticker, showing your reasoning

CRITICAL: Only include tickers you are confident exist and are US-tradable. If unsure of the ticker, omit the row.

Return ONLY valid JSON of shape:
{
  "eggs": [
    { "ticker": "STR", "company_name": "...", "thesis": "1-2 sentences", "hop_distance": 2, "confidence": 0.8, "novelty_score": 0.7, "timing_lag": "concurrent", "sector": "Industrials", "ripple_path": [{"node": "AI Datacenter", "relation": "depends_on"}, {"node": "Grid power", "relation": "uses"}] }
  ]
}`;

  try {
    // The prompt asks for 4-8 eggs, each with a thesis and a ripple path. At
    // 3000 the reply was cut off mid-JSON, parsing failed, and every premium
    // call silently produced zero eggs — after being paid for. Measured: a real
    // reply runs ~5k characters, so give it real headroom.
    const text = await getLlm().complete(prompt, { tier: "premium", maxTokens: 8000 });
    const parsed = extractJson(text) as RippleOutput | null;
    if (parsed === null) {
      // Distinguish "model said nothing useful" from "we failed to read it".
      logger.warn({ theme, chars: text.length }, "analyzeTheme: response did not parse as JSON");
    }
    return parsed ?? { eggs: [] };
  } catch (e) {
    logger.warn({ err: e, theme }, "analyzeTheme failed — returning no eggs");
    return { eggs: [] };
  }
}

// ---------------------------------------------------------------
// End-to-end: process a batch of newly-ingested catalysts
// ---------------------------------------------------------------
export type ScanStats = {
  catalystsProcessed: number;
  catalystsKept: number;
  /** Triaged out (not material, or no canonical theme). Marked so they aren't reconsidered. */
  catalystsRejected: number;
  /** Eggs skipped because their ticker didn't resolve a live quote (likely delisted). */
  tickersUnresolved: number;
  /** Eggs dropped because web grounding found clear evidence against them. */
  eggsRefuted: number;
  /** Eggs skipped because the exchange's name for the ticker doesn't match the model's. */
  nameMismatches: number;
  themesAnalyzed: number;
  cacheHits: number;
  eggsCreated: number;
  approxCredits: number;
  /** True when the run stopped analyzing themes because it hit maxCredits. */
  budgetExhausted: boolean;
};

/** Approximate credit cost of one premium ripple analysis. */
const PREMIUM_CALL_CREDITS = 15;
/** Approximate credit cost of one web-grounding pass (model + searches). */
const GROUNDING_CREDITS = 5;

export async function processCatalysts(catalysts: Catalyst[], maxCredits = Infinity): Promise<ScanStats> {
  const stats: ScanStats = {
    catalystsProcessed: catalysts.length,
    catalystsKept: 0,
    catalystsRejected: 0,
    tickersUnresolved: 0,
    eggsRefuted: 0,
    nameMismatches: 0,
    themesAnalyzed: 0,
    cacheHits: 0,
    eggsCreated: 0,
    approxCredits: 0,
    budgetExhausted: false,
  };
  if (catalysts.length === 0) return stats;

  // Tier 1: cheap classification
  const classified = await classifyCatalysts(catalysts);
  stats.approxCredits += Math.ceil(catalysts.length * 0.5);
  const keeps = classified.filter((c) => c.keep && c.strength > 0.4);
  stats.catalystsKept = keeps.length;

  // Retire the ones we're not analyzing.
  //
  // Only catalysts inside a theme group used to be marked, so a rejected
  // catalyst stayed rippleAnalyzed=false forever: re-classified on every scan,
  // and permanently occupying a slot under the per-run cap. With a strict
  // canonical vocabulary most catalysts ARE rejected, so the backlog grew until
  // the cap was pure rejects and no new catalyst could ever be analyzed.
  // Triage is a decision — record it.
  const keptIds = new Set(keeps.map((k) => k.catalyst_id));
  const rejected = classified.filter((c) => !keptIds.has(c.catalyst_id));
  for (const r of rejected) {
    // Keep the theme when the classifier managed to place it — rejecting for
    // low strength doesn't make the subject unknown, and rollups still want it.
    await storage.markCatalystAnalyzed(r.catalyst_id, 0, r.normalized_theme || undefined);
  }
  stats.catalystsRejected = rejected.length;
  if (rejected.length > 0) {
    logger.info({ rejected: rejected.length, kept: keeps.length }, "catalysts triaged");
  }

  // Group by normalized theme
  const themeGroups = new Map<string, { theme: string; catalysts: Catalyst[]; strength: number }>();
  for (const k of keeps) {
    const cat = catalysts.find((c) => c.id === k.catalyst_id);
    if (!cat) continue;
    const key = k.normalized_theme.toLowerCase().trim();
    if (!themeGroups.has(key)) {
      themeGroups.set(key, { theme: k.normalized_theme, catalysts: [cat], strength: k.strength });
    } else {
      const g = themeGroups.get(key)!;
      g.catalysts.push(cat);
      g.strength = Math.max(g.strength, k.strength);
    }
  }

  // Collect eggs to create so we can batch a single quote request at the end
  const eggsToCreate: Array<{ anchor: Catalyst; egg: RippleOutput["eggs"][number] }> = [];

  for (const [key, group] of Array.from(themeGroups.entries())) {
    const th = themeHash(key);
    const cached = await storage.getCache(th);
    let output: RippleOutput;

    const isFresh = cached && (!cached.expiresAt || cached.expiresAt > Date.now());
    if (isFresh) {
      stats.cacheHits++;
      await storage.incrementCacheHit(cached!.id);
      try {
        output = JSON.parse(cached!.outputJson) as RippleOutput;
      } catch {
        output = { eggs: [] };
      }
    } else {
      // Credit ceiling: a cache miss means a premium call. If that would blow
      // the run's budget, stop analyzing new themes and leave the remaining
      // catalysts unanalyzed so the next scan picks them up.
      if (stats.approxCredits + PREMIUM_CALL_CREDITS > maxCredits) {
        stats.budgetExhausted = true;
        logger.warn(
          { spent: stats.approxCredits, maxCredits, theme: group.theme },
          "credit ceiling reached \u2014 deferring remaining themes to the next scan"
        );
        break;
      }
      if (cached) {
        // stale \u2014 remove before re-inserting
        await storage.deleteCache(th);
      }
      const summary = group.catalysts
        .map((c) => c.title)
        .join(" | ")
        .slice(0, 800);
      output = await analyzeTheme(group.theme, summary);
      stats.themesAnalyzed++;
      stats.approxCredits += PREMIUM_CALL_CREDITS;
      // Fact-check BEFORE caching, so cached reuse inherits the verdicts and a
      // refuted egg never comes back from the cache.
      if (output.eggs.length > 0) {
        const verdicts = await groundEggs(group.theme, output.eggs);
        if (verdicts.length > 0) {
          const { kept, refuted } = applyGrounding(output.eggs, verdicts);
          output = { eggs: kept };
          stats.eggsRefuted += refuted.length;
          stats.approxCredits += GROUNDING_CREDITS;
          for (const r of refuted) {
            logger.warn({ ticker: r.ticker, theme: group.theme }, "egg refuted by web grounding");
          }
        }
      }
      // Only cache non-empty results. An empty output (thin theme, transient
      // model hiccup) would otherwise poison this theme for the full 30-day TTL;
      // leaving it uncached lets a future catalyst on the same theme retry.
      if (output.eggs.length > 0) {
        const now = Date.now();
        await storage.putCache({
          themeHash: th,
          themeSummary: group.theme,
          outputJson: JSON.stringify(output),
          model: env.LLM_PROVIDER === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL,
          createdAt: now,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
    }

    const anchor = group.catalysts[0];
    // A model can repeat a ticker within one output. (catalystId, ticker) is
    // unique in the DB, but drop dupes here so we don't waste an insert or
    // double-count eggsCreated.
    const seenTickers = new Set<string>();
    for (const e of output.eggs) {
      if (!e.ticker) continue;
      const key = e.ticker.trim().toUpperCase();
      if (!key || seenTickers.has(key)) continue;
      seenTickers.add(key);
      eggsToCreate.push({ anchor, egg: e });
    }
    // Record the canonical theme this group was analyzed under. Without it,
    // rollups fall back to catalysts.theme — which is the source feed's label
    // ("energy data"), not what the catalyst is actually about.
    await storage.markCatalystAnalyzed(anchor.id, isFresh ? 0 : 15, group.theme);
    for (const c of group.catalysts.slice(1)) {
      await storage.markCatalystAnalyzed(c.id, 0, group.theme);
    }
  }

  // Batch price capture for all new eggs
  const nowTs = Date.now();
  const uniqueTickers = Array.from(new Set(eggsToCreate.map((x) => x.egg.ticker.toUpperCase())));
  let priceMap: Record<string, number> = {};
  if (uniqueTickers.length > 0) {
    try {
      priceMap = await fetchQuotes(uniqueTickers);
    } catch {
      priceMap = {};
    }
  }

  // The exchange's own name for each ticker — catches the model pairing a real
  // ticker with the wrong company, and lets us store the official name.
  const officialNames: Record<string, string> = {};
  const nameProvider = getQuotes();
  if (nameProvider.companyName) {
    for (const tk of Object.keys(priceMap)) {
      const official = await nameProvider.companyName(tk).catch(() => null);
      if (official) officialNames[tk] = official;
    }
  }

  for (const { anchor, egg: e } of eggsToCreate) {
    const tk = e.ticker.trim().toUpperCase();
    const p = priceMap[tk];
    // Ticker sanity check. The model sometimes recommends names that no longer
    // trade — real finds from this dataset: DNB (taken private), WNS (acquired),
    // CEIX (merged away). If the quote batch worked for OTHER tickers but not
    // this one, it almost certainly doesn't trade, and an egg we can never
    // price can never be scored — it would just sit in every list as dead
    // weight. Skipped only when the batch itself succeeded, so a provider
    // outage (empty priceMap) never wipes a whole scan's eggs.
    if (Object.keys(priceMap).length > 0 && !(tk in priceMap)) {
      stats.tickersUnresolved++;
      logger.warn(
        { ticker: tk, company: e.company_name },
        "egg skipped — ticker didn't resolve a quote (likely delisted or wrong)"
      );
      continue;
    }
    const official = officialNames[tk];
    if (official && !namesLookAlike(e.company_name, official)) {
      stats.nameMismatches++;
      logger.warn(
        { ticker: tk, modelName: e.company_name, exchangeName: official },
        "egg skipped — ticker belongs to a different company than the model claimed"
      );
      continue;
    }
    const created = await storage.createEgg({
      catalystId: anchor.id,
      ticker: tk,
      companyName: official ?? e.company_name,
      thesis: e.thesis,
      hopDistance: e.hop_distance,
      confidence: e.confidence,
      noveltyScore: e.novelty_score ?? 0.5,
      timingLag: e.timing_lag,
      // Canonical for rollups; the model's original string is kept alongside so
      // detail like "Industrials / Cash Logistics" isn't lost.
      sector: coerceToSector(e.sector),
      sectorDetail: e.sector ?? null,
      ripplePath: JSON.stringify(e.ripple_path ?? []),
      priceAtFlag: Number.isFinite(p) ? p : null,
      priceAtFlagDate: Number.isFinite(p) ? nowTs : null,
      currentPrice: Number.isFinite(p) ? p : null,
      priceRefreshedAt: Number.isFinite(p) ? nowTs : null,
      verified: e.verified ?? null,
      createdAt: nowTs,
    });
    // undefined => the (catalystId, ticker) row already existed. Don't report it
    // as created; eggsCreated should mean rows that actually landed.
    if (created) stats.eggsCreated++;
  }

  return stats;
}
