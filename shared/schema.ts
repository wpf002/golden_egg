import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * CATALYSTS — Emerging or trending market drivers.
 * Each catalyst is a "gold rush" (AI datacenters, CBD boom, EV mandate, etc.).
 * Deduped by content_hash so repeat sightings don't re-trigger premium LLM work.
 */
export const catalysts = sqliteTable(
  "catalysts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contentHash: text("content_hash").notNull().unique(), // dedupe key
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    theme: text("theme").notNull(), // e.g. "AI infrastructure", "GLP-1 drugs"
    sourceType: text("source_type").notNull(), // "sec_8k" | "rss" | "market_signal" | "seed" | "manual"
    sourceUrl: text("source_url"),
    strengthScore: real("strength_score").notNull().default(0), // 0-1: how strong is this catalyst
    firstSeenAt: integer("first_seen_at").notNull(), // unix ms
    lastSeenAt: integer("last_seen_at").notNull(),
    rippleAnalyzed: integer("ripple_analyzed", { mode: "boolean" }).notNull().default(false),
    rippleCostCredits: integer("ripple_cost_credits").notNull().default(0), // approx credits spent on premium reasoning
  },
  (t) => ({
    themeIdx: index("catalysts_theme_idx").on(t.theme),
    seenIdx: index("catalysts_last_seen_idx").on(t.lastSeenAt),
  })
);

/**
 * GRAPH NODES — Industries, companies, materials, equipment, services.
 * The supply-chain knowledge graph. Grows over time.
 */
export const nodes = sqliteTable(
  "nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(), // e.g. "hbm-memory", "armored-truck-parts"
    name: text("name").notNull(),
    kind: text("kind").notNull(), // "industry" | "company" | "material" | "equipment" | "service" | "commodity"
    ticker: text("ticker"), // if publicly tradable
    description: text("description"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    kindIdx: index("nodes_kind_idx").on(t.kind),
    tickerIdx: index("nodes_ticker_idx").on(t.ticker),
  })
);

/**
 * GRAPH EDGES — Directional relationships between nodes.
 * Types: supplies (A supplies B), depends_on (A depends on B),
 *        co_moves (correlated), substitutes (alternatives).
 */
export const edges = sqliteTable(
  "edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromNodeId: integer("from_node_id").notNull(),
    toNodeId: integer("to_node_id").notNull(),
    relation: text("relation").notNull(), // supplies | depends_on | co_moves | substitutes | uses
    strength: real("strength").notNull().default(0.5), // 0-1
    note: text("note"),
  },
  (t) => ({
    fromIdx: index("edges_from_idx").on(t.fromNodeId),
    toIdx: index("edges_to_idx").on(t.toNodeId),
  })
);

/**
 * GOLDEN EGGS — Predicted parallel/ancillary beneficiaries of a catalyst.
 * The output of the ripple reasoning step.
 */
export const goldenEggs = sqliteTable(
  "golden_eggs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    catalystId: integer("catalyst_id").notNull(),
    ticker: text("ticker").notNull(), // required — must be tradable
    companyName: text("company_name").notNull(),
    thesis: text("thesis").notNull(), // why this benefits from the catalyst
    hopDistance: integer("hop_distance").notNull(), // 1 = direct supplier, 2 = 2nd order, 3 = 3rd order
    confidence: real("confidence").notNull(), // 0-1
    noveltyScore: real("novelty_score").notNull().default(0.5), // higher = less obvious
    timingLag: text("timing_lag").notNull(), // "leading" | "concurrent" | "lagging"
    sector: text("sector"),
    ripplePath: text("ripple_path"), // JSON: [{node, relation}, ...] the chain from catalyst to ticker
    priceAtFlag: real("price_at_flag"), // set when we first flag it
    priceAtFlagDate: integer("price_at_flag_date"),
    currentPrice: real("current_price"),
    priceRefreshedAt: integer("price_refreshed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    catIdx: index("eggs_catalyst_idx").on(t.catalystId),
    tickerIdx: index("eggs_ticker_idx").on(t.ticker),
    confIdx: index("eggs_confidence_idx").on(t.confidence),
  })
);

/**
 * WATCHLIST — User-saved eggs to track over time.
 */
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eggId: integer("egg_id").notNull().unique(),
  addedAt: integer("added_at").notNull(),
  notes: text("notes"),
});

/**
 * RIPPLE CACHE — Cache of (theme_hash -> LLM output JSON) so repeated catalysts skip premium calls.
 * This is the primary credit-saving mechanism.
 */
export const rippleCache = sqliteTable("ripple_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  themeHash: text("theme_hash").notNull().unique(),
  themeSummary: text("theme_summary").notNull(),
  outputJson: text("output_json").notNull(), // full LLM ripple analysis
  model: text("model").notNull(),
  createdAt: integer("created_at").notNull(),
  hitCount: integer("hit_count").notNull().default(0),
  expiresAt: integer("expires_at"),
});

/**
 * SCAN RUNS — History of scheduled scans for observability and credit tracking.
 */
export const scanRuns = sqliteTable("scan_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  catalystsIngested: integer("catalysts_ingested").notNull().default(0),
  catalystsNew: integer("catalysts_new").notNull().default(0),
  eggsCreated: integer("eggs_created").notNull().default(0),
  cacheHits: integer("cache_hits").notNull().default(0),
  approxCredits: integer("approx_credits").notNull().default(0),
  status: text("status").notNull(), // "running" | "success" | "error"
  errorMessage: text("error_message"),
});

// ---- Insert schemas ----
export const insertCatalystSchema = createInsertSchema(catalysts).omit({ id: true });
export const insertNodeSchema = createInsertSchema(nodes).omit({ id: true });
export const insertEdgeSchema = createInsertSchema(edges).omit({ id: true });
export const insertGoldenEggSchema = createInsertSchema(goldenEggs).omit({ id: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true });
export const insertRippleCacheSchema = createInsertSchema(rippleCache).omit({ id: true });
export const insertScanRunSchema = createInsertSchema(scanRuns).omit({ id: true });

// ---- Types ----
export type Catalyst = typeof catalysts.$inferSelect;
export type InsertCatalyst = z.infer<typeof insertCatalystSchema>;
export type Node = typeof nodes.$inferSelect;
export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Edge = typeof edges.$inferSelect;
export type InsertEdge = z.infer<typeof insertEdgeSchema>;
export type GoldenEgg = typeof goldenEggs.$inferSelect;
export type InsertGoldenEgg = z.infer<typeof insertGoldenEggSchema>;
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type RippleCache = typeof rippleCache.$inferSelect;
export type InsertRippleCache = z.infer<typeof insertRippleCacheSchema>;
export type ScanRun = typeof scanRuns.$inferSelect;
export type InsertScanRun = z.infer<typeof insertScanRunSchema>;

// ---- Enriched view types (for API responses) ----
export type GoldenEggWithCatalyst = GoldenEgg & {
  catalyst: Pick<Catalyst, "id" | "title" | "theme" | "sourceUrl">;
  onWatchlist?: boolean;
};

// Canonical theme names — the classifier MUST pick one.
// Keeping this list tight is the primary cache-hit lever.
export const CANONICAL_THEMES = [
  "AI datacenter buildout",
  "Grid & power infrastructure",
  "Nuclear & SMR renaissance",
  "GLP-1 obesity drugs",
  "US reshoring & industrial capex",
  "Semiconductor supply chain",
  "Cannabis cash logistics",
  "EV & battery supply chain",
  "Sports betting & iGaming",
  "Quantum computing",
  "Defense & aerospace spend",
  "Critical minerals & rare earths",
  "Cybersecurity & AI safety",
  "Space economy",
  "Water infrastructure",
  "Aging population healthcare",
] as const;
export type CanonicalTheme = (typeof CANONICAL_THEMES)[number];

export type CatalystWithEggs = Catalyst & {
  eggs: GoldenEgg[];
};
