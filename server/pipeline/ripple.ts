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
import { coerceToCanonical, extractJson } from "./ripple-utils";

// Re-exported for callers/tests that import them from the pipeline entrypoint.
export { coerceToCanonical, extractJson };

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

export async function classifyCatalysts(catalysts: Catalyst[]): Promise<ClassifiedCatalyst[]> {
  if (catalysts.length === 0) return [];
  const items = catalysts.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 200),
    theme: c.theme,
    summary: c.summary.slice(0, 250),
  }));

  const themeList = CANONICAL_THEMES.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `You are triaging market catalysts for a parallel-market ("picks and shovels") equity screener.

For EACH item below decide:
  keep: true only if this represents a MATERIAL, ripple-generating shift (secular demand, regulation, tech adoption, supply shock). Reject vague news, single-quarter noise, company-specific PR, minor executive changes, personnel changes, dividend declarations, buybacks, share splits, quarterly-only earnings reactions.
  normalized_theme: pick EXACTLY one theme from the CANONICAL LIST below. If nothing on the list fits, set keep=false. Never invent new theme names \u2014 the cache depends on identical strings.
  strength: 0-1. How large is the second-order economic ripple?
  rationale: one short sentence.

CANONICAL THEMES (pick one verbatim):
${themeList}

Items:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON object of shape: { "results": [{ "catalyst_id": N, "keep": bool, "normalized_theme": "...", "strength": 0.x, "rationale": "..." }] }`;

  try {
    const text = await getLlm().complete(prompt, { tier: "cheap", maxTokens: 2000 });
    const parsed = extractJson(text);
    const results = (parsed?.results ?? []) as ClassifiedCatalyst[];
    return results.map((r) => ({ ...r, normalized_theme: coerceToCanonical(r.normalized_theme || "") }));
  } catch (e) {
    console.warn("classifyCatalysts failed:", (e as Error).message);
    return catalysts.map((c) => ({
      catalyst_id: c.id,
      keep: false,
      normalized_theme: c.theme,
      strength: 0.3,
      rationale: "classifier error",
    }));
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
    const text = await getLlm().complete(prompt, { tier: "premium", maxTokens: 3000 });
    const parsed = extractJson(text) as RippleOutput | null;
    return parsed ?? { eggs: [] };
  } catch (e) {
    console.warn("analyzeTheme failed:", (e as Error).message);
    return { eggs: [] };
  }
}

// ---------------------------------------------------------------
// End-to-end: process a batch of newly-ingested catalysts
// ---------------------------------------------------------------
export type ScanStats = {
  catalystsProcessed: number;
  catalystsKept: number;
  themesAnalyzed: number;
  cacheHits: number;
  eggsCreated: number;
  approxCredits: number;
};

export async function processCatalysts(catalysts: Catalyst[]): Promise<ScanStats> {
  const stats: ScanStats = {
    catalystsProcessed: catalysts.length,
    catalystsKept: 0,
    themesAnalyzed: 0,
    cacheHits: 0,
    eggsCreated: 0,
    approxCredits: 0,
  };
  if (catalysts.length === 0) return stats;

  // Tier 1: cheap classification
  const classified = await classifyCatalysts(catalysts);
  stats.approxCredits += Math.ceil(catalysts.length * 0.5);
  const keeps = classified.filter((c) => c.keep && c.strength > 0.4);
  stats.catalystsKept = keeps.length;

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
      stats.approxCredits += 15;
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
    for (const e of output.eggs) {
      if (!e.ticker) continue;
      eggsToCreate.push({ anchor, egg: e });
    }
    await storage.markCatalystAnalyzed(anchor.id, isFresh ? 0 : 15);
    for (const c of group.catalysts.slice(1)) {
      await storage.markCatalystAnalyzed(c.id, 0);
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

  for (const { anchor, egg: e } of eggsToCreate) {
    const tk = e.ticker.toUpperCase();
    const p = priceMap[tk];
    await storage.createEgg({
      catalystId: anchor.id,
      ticker: tk,
      companyName: e.company_name,
      thesis: e.thesis,
      hopDistance: e.hop_distance,
      confidence: e.confidence,
      noveltyScore: e.novelty_score ?? 0.5,
      timingLag: e.timing_lag,
      sector: e.sector,
      ripplePath: JSON.stringify(e.ripple_path ?? []),
      priceAtFlag: Number.isFinite(p) ? p : null,
      priceAtFlagDate: Number.isFinite(p) ? nowTs : null,
      currentPrice: Number.isFinite(p) ? p : null,
      priceRefreshedAt: Number.isFinite(p) ? nowTs : null,
      createdAt: nowTs,
    });
    stats.eggsCreated++;
  }

  return stats;
}
