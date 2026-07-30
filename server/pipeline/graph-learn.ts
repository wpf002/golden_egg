/**
 * Graph learning — fold every scan's reasoning back into the knowledge graph.
 *
 * Each egg carries a ripple_path: the chain the model walked from catalyst to
 * ticker ("AI Datacenter" -> "Grid power" -> "Gas turbines" -> "GE Vernova").
 * That chain is exactly the market-feeds-market hierarchy the Supply Graph is
 * supposed to show, but until now it was serialized onto the egg and never
 * written back — the graph stayed frozen at its seeded 100 nodes while
 * hundreds of learned chains piled up unused.
 *
 * This harvests them: every chain link becomes nodes + a directed edge, so the
 * graph deepens on its own with each scan. Conservative by design — the graph
 * is long-lived shared state, and junk in it is worse than a missed edge:
 *   - names are normalized and length-bounded before they can mint a node
 *   - a slug already in the graph is reused, never duplicated
 *   - an edge that already exists is never written twice
 *   - per-run caps keep one bad analysis from flooding the graph
 */
import { storage } from "../storage";
import { log } from "../logger";

const logger = log("graph-learn");

/** Relations the schema understands. Anything else is coerced to depends_on. */
const RELATIONS = new Set(["supplies", "depends_on", "co_moves", "substitutes", "uses"]);

const MAX_NEW_NODES_PER_RUN = 60;
const MAX_NEW_EDGES_PER_RUN = 120;

export type ChainNode = {
  slug: string;
  name: string;
  kind: "industry" | "company";
  ticker: string | null;
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Turn one raw chain label into a node spec.
 *
 * The model writes companies as "Constellation Energy (CEG)" and markets as
 * bare phrases, so a trailing all-caps parenthetical is the ticker signal.
 * Returns null for anything too short, too long, or purely punctuation —
 * those are model noise, not concepts worth a permanent node.
 */
export function parseChainNode(raw: string): ChainNode | null {
  const trimmed = (raw ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length < 3 || trimmed.length > 80) return null;

  // "Company Name (TICK)" / "Company Name (TICK.DE)"
  const m = trimmed.match(/^(.+?)\s*\(([A-Z][A-Z0-9.-]{0,9})\)$/);
  const name = (m ? m[1] : trimmed).trim();
  const ticker = m ? m[2].toUpperCase() : null;
  if (name.length < 3) return null;
  if (!/[a-z]/i.test(name)) return null; // no letters => junk

  const slug = slugify(name);
  if (!slug) return null;

  return { slug, name, kind: ticker ? "company" : "industry", ticker };
}

export function normalizeRelation(rel: unknown): string {
  const r = String(rel ?? "")
    .toLowerCase()
    .trim();
  return RELATIONS.has(r) ? r : "depends_on";
}

type PathLink = { node?: unknown; relation?: unknown };

/**
 * Pure: expand ripple paths into the node specs and directed links they imply.
 *
 * A path is ordered catalyst-side first, so link i -> i+1 is "upstream feeds
 * downstream". The relation stored on link i describes how it connects to the
 * next hop, which is why the relation is read off the SOURCE element.
 */
export function chainsToGraph(paths: PathLink[][]): {
  nodes: Map<string, ChainNode>;
  links: Array<{ from: string; to: string; relation: string }>;
} {
  const nodes = new Map<string, ChainNode>();
  const links: Array<{ from: string; to: string; relation: string }> = [];
  const seenLink = new Set<string>();

  for (const path of paths) {
    if (!Array.isArray(path) || path.length < 2) continue;
    const parsed = path.map((p) => parseChainNode(String(p?.node ?? "")));
    for (let i = 0; i < parsed.length - 1; i++) {
      const a = parsed[i];
      const b = parsed[i + 1];
      if (!a || !b || a.slug === b.slug) continue;
      // A company already carrying a ticker is the richer record; keep it.
      if (!nodes.has(a.slug) || (a.ticker && !nodes.get(a.slug)!.ticker)) nodes.set(a.slug, a);
      if (!nodes.has(b.slug) || (b.ticker && !nodes.get(b.slug)!.ticker)) nodes.set(b.slug, b);
      const relation = normalizeRelation(path[i]?.relation);
      const key = `${a.slug}|${b.slug}|${relation}`;
      if (seenLink.has(key)) continue;
      seenLink.add(key);
      links.push({ from: a.slug, to: b.slug, relation });
    }
  }
  return { nodes, links };
}

export type LearnStats = { nodesAdded: number; edgesAdded: number; considered: number };

/**
 * Harvest the given ripple paths into the graph. Idempotent: re-running with
 * the same paths adds nothing, because slugs and edges are checked first.
 */
export async function learnFromPaths(rawPaths: string[]): Promise<LearnStats> {
  const paths: PathLink[][] = [];
  for (const raw of rawPaths) {
    try {
      const p = JSON.parse(raw || "[]");
      if (Array.isArray(p)) paths.push(p);
    } catch {
      // A malformed path is one bad row, not a reason to abandon the harvest.
    }
  }
  const { nodes, links } = chainsToGraph(paths);
  const stats: LearnStats = { nodesAdded: 0, edgesAdded: 0, considered: links.length };
  if (links.length === 0) return stats;

  // Resolve every slug to an id, creating what's missing (capped).
  const existing = await storage.listNodes();
  const idBySlug = new Map(existing.map((n) => [n.slug, n.id]));
  const now = Date.now();
  for (const [slug, spec] of nodes) {
    if (idBySlug.has(slug)) continue;
    if (stats.nodesAdded >= MAX_NEW_NODES_PER_RUN) break;
    const created = await storage.upsertNode({
      slug,
      name: spec.name,
      kind: spec.kind,
      ticker: spec.ticker,
      description: null,
      createdAt: now,
    });
    idBySlug.set(slug, created.id);
    stats.nodesAdded++;
  }

  const allEdges = await storage.listAllEdges();
  const haveEdge = new Set(allEdges.map((e) => `${e.fromNodeId}|${e.toNodeId}|${e.relation}`));
  for (const l of links) {
    if (stats.edgesAdded >= MAX_NEW_EDGES_PER_RUN) break;
    const from = idBySlug.get(l.from);
    const to = idBySlug.get(l.to);
    if (!from || !to) continue; // one side hit the node cap
    const key = `${from}|${to}|${l.relation}`;
    if (haveEdge.has(key)) continue;
    haveEdge.add(key);
    await storage.createEdge({
      fromNodeId: from,
      toNodeId: to,
      relation: l.relation,
      // Learned edges start below seeded ones (0.5+): they're one model's
      // reasoning, not a curated relationship.
      strength: 0.4,
      note: "learned from scan",
    });
    stats.edgesAdded++;
  }

  if (stats.nodesAdded || stats.edgesAdded) {
    logger.info(stats, "graph learned from ripple paths");
  }
  return stats;
}
