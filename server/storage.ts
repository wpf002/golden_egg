import {
  catalysts,
  nodes,
  edges,
  goldenEggs,
  watchlist,
  rippleCache,
  scanRuns,
  priceAlerts,
  dailyCloses,
} from "@shared/schema";
import type {
  Catalyst,
  InsertCatalyst,
  Node as GraphNode,
  InsertNode,
  Edge as GraphEdge,
  InsertEdge,
  GoldenEgg,
  InsertGoldenEgg,
  GoldenEggWithCatalyst,
  Watchlist,
  InsertWatchlist,
  RippleCache,
  InsertRippleCache,
  ScanRun,
  InsertScanRun,
  PriceAlert,
  InsertPriceAlert,
  PriceAlertWithEgg,
  InsertDailyClose,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, asc, sql, lt, lte, gte, and, isNotNull, isNull } from "drizzle-orm";
import { env } from "./config";
import { runMigrations } from "./migrate";
import { NODE_DESCRIPTIONS } from "./graph-descriptions";

export const sqlite = new Database(env.DB_PATH);
sqlite.pragma("journal_mode = WAL");
// Enforce referential intent and make concurrent readers wait rather than fail.
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

// Versioned migrations, applied once at startup. (This replaced a set of
// unversioned addColumnIfMissing calls that ran on every boot.)
runMigrations(sqlite);

// Fill in descriptions for seeded graph nodes that predate the description
// catalog. Idempotent: only touches rows whose description is still empty,
// so nothing a user (or future seed) wrote gets overwritten.
{
  const upd = sqlite.prepare(
    "UPDATE nodes SET description = ? WHERE slug = ? AND (description IS NULL OR description = '')"
  );
  const backfill = sqlite.transaction(() => {
    for (const [slug, description] of Object.entries(NODE_DESCRIPTIONS)) upd.run(description, slug);
  });
  backfill();
}

export const db = drizzle(sqlite);

export interface IStorage {
  // Catalysts
  getCatalyst(id: number): Promise<Catalyst | undefined>;
  getCatalystByHash(hash: string): Promise<Catalyst | undefined>;
  listCatalysts(limit?: number): Promise<Catalyst[]>;
  createCatalyst(c: InsertCatalyst): Promise<Catalyst>;
  /** Mark analyzed, recording the canonical theme it was actually analyzed under. */
  markCatalystAnalyzed(id: number, credits: number, canonicalTheme?: string): Promise<void>;
  /** Set the canonical theme without touching analysis state (used by the backfill). */
  setCanonicalTheme(id: number, canonicalTheme: string): Promise<void>;
  touchCatalyst(id: number, ts: number): Promise<void>;

  // Nodes
  getNode(id: number): Promise<GraphNode | undefined>;
  getNodeBySlug(slug: string): Promise<GraphNode | undefined>;
  getNodeByTicker(ticker: string): Promise<GraphNode | undefined>;
  listNodes(): Promise<GraphNode[]>;
  createNode(n: InsertNode): Promise<GraphNode>;
  upsertNode(n: InsertNode): Promise<GraphNode>;

  // Edges
  createEdge(e: InsertEdge): Promise<GraphEdge>;
  listEdgesFrom(nodeId: number): Promise<GraphEdge[]>;
  listEdgesTo(nodeId: number): Promise<GraphEdge[]>;
  listAllEdges(): Promise<GraphEdge[]>;

  // Golden eggs
  /** Insert an egg. Returns undefined if (catalystId, ticker) already exists. */
  createEgg(e: InsertGoldenEgg): Promise<GoldenEgg | undefined>;
  listEggs(opts?: {
    minConfidence?: number;
    sector?: string;
    limit?: number;
  }): Promise<GoldenEggWithCatalyst[]>;
  getEgg(id: number): Promise<GoldenEggWithCatalyst | undefined>;
  getEggsForCatalyst(catalystId: number): Promise<GoldenEgg[]>;
  updateEggPrice(id: number, price: number, refreshedAt: number): Promise<void>;
  updateEggFlagPrice(id: number, price: number, flagDate: number): Promise<void>;
  listAllEggs(): Promise<GoldenEgg[]>;

  // Watchlist
  addToWatchlist(w: InsertWatchlist): Promise<Watchlist>;
  removeFromWatchlist(eggId: number): Promise<void>;
  listWatchlist(): Promise<GoldenEggWithCatalyst[]>;
  isOnWatchlist(eggId: number): Promise<boolean>;

  // Daily closes (local cache — see pipeline/closes.ts for why)
  /** Upsert closes. Returns rows written. */
  putDailyCloses(rows: InsertDailyClose[]): Promise<number>;
  /** Closes for one ticker in [fromYmd, toYmd], ascending. */
  getDailyCloses(ticker: string, fromYmd: string, toYmd: string): Promise<{ date: string; close: number }[]>;
  /** Dates already cached, so a backfill can skip them. */
  listCachedCloseDates(): Promise<string[]>;
  /** Every cached close since `fromYmd`, keyed by ticker — one query for a whole page of sparklines. */
  getClosesSince(fromYmd: string): Promise<Record<string, { date: string; close: number }[]>>;

  // Price alerts
  createAlert(a: InsertPriceAlert): Promise<PriceAlert>;
  /** An unacknowledged alert for this egg+direction, if one exists. */
  getOpenAlert(eggId: number, direction: string): Promise<PriceAlert | undefined>;
  listAlerts(limit?: number): Promise<PriceAlertWithEgg[]>;
  acknowledgeAlert(id: number, ts: number): Promise<void>;
  acknowledgeAllAlerts(ts: number): Promise<number>;

  // Ripple cache
  getCache(themeHash: string): Promise<RippleCache | undefined>;
  putCache(c: InsertRippleCache): Promise<RippleCache>;
  incrementCacheHit(id: number): Promise<void>;
  deleteCache(themeHash: string): Promise<void>;
  /** Delete expired cache rows. Returns how many were removed. */
  sweepExpiredCache(nowTs: number): Promise<number>;

  // Scan runs
  /**
   * Atomically claim the single "running" scan slot. Returns the new run, or
   * the in-flight run if one is already active. A run older than staleMs is
   * treated as abandoned (server died mid-scan) and force-failed so a crash
   * can't block scanning forever.
   */
  tryStartScanRun(
    nowTs: number,
    staleMs: number
  ): Promise<{ ok: true; run: ScanRun } | { ok: false; running: ScanRun }>;
  createScanRun(r: InsertScanRun): Promise<ScanRun>;
  finishScanRun(id: number, patch: Partial<ScanRun>): Promise<void>;
  listScanRuns(limit?: number): Promise<ScanRun[]>;
  getLatestScanRun(): Promise<ScanRun | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Catalysts
  async getCatalyst(id: number) {
    return db.select().from(catalysts).where(eq(catalysts.id, id)).get();
  }
  async getCatalystByHash(hash: string) {
    return db.select().from(catalysts).where(eq(catalysts.contentHash, hash)).get();
  }
  async listCatalysts(limit = 100) {
    return db.select().from(catalysts).orderBy(desc(catalysts.lastSeenAt)).limit(limit).all();
  }
  async createCatalyst(c: InsertCatalyst) {
    return db.insert(catalysts).values(c).returning().get();
  }
  async markCatalystAnalyzed(id: number, credits: number, canonicalTheme?: string) {
    db.update(catalysts)
      .set({
        rippleAnalyzed: true,
        rippleCostCredits: credits,
        ...(canonicalTheme ? { canonicalTheme } : {}),
      })
      .where(eq(catalysts.id, id))
      .run();
  }
  async setCanonicalTheme(id: number, canonicalTheme: string) {
    db.update(catalysts).set({ canonicalTheme }).where(eq(catalysts.id, id)).run();
  }
  async touchCatalyst(id: number, ts: number) {
    db.update(catalysts).set({ lastSeenAt: ts }).where(eq(catalysts.id, id)).run();
  }

  // Nodes
  async getNode(id: number) {
    return db.select().from(nodes).where(eq(nodes.id, id)).get();
  }
  async getNodeBySlug(slug: string) {
    return db.select().from(nodes).where(eq(nodes.slug, slug)).get();
  }
  async getNodeByTicker(ticker: string) {
    return db.select().from(nodes).where(eq(nodes.ticker, ticker)).get();
  }
  async listNodes() {
    return db.select().from(nodes).all();
  }
  async createNode(n: InsertNode) {
    return db.insert(nodes).values(n).returning().get();
  }
  async upsertNode(n: InsertNode) {
    const existing = await this.getNodeBySlug(n.slug);
    if (existing) return existing;
    return this.createNode(n);
  }

  // Edges
  async createEdge(e: InsertEdge) {
    return db.insert(edges).values(e).returning().get();
  }
  async listEdgesFrom(nodeId: number) {
    return db.select().from(edges).where(eq(edges.fromNodeId, nodeId)).all();
  }
  async listEdgesTo(nodeId: number) {
    return db.select().from(edges).where(eq(edges.toNodeId, nodeId)).all();
  }
  async listAllEdges() {
    return db.select().from(edges).all();
  }

  // Golden eggs
  async createEgg(e: InsertGoldenEgg) {
    // (catalystId, ticker) is unique. A model that repeats a ticker within one
    // ripple output shouldn't abort the scan — skip the dupe and carry on.
    // Returns undefined when the row already existed.
    return db.insert(goldenEggs).values(e).onConflictDoNothing().returning().get();
  }
  async listEggs(opts: { minConfidence?: number; sector?: string; limit?: number } = {}) {
    const rows = db
      .select({
        egg: goldenEggs,
        catalyst: catalysts,
        watchId: watchlist.id,
      })
      .from(goldenEggs)
      .leftJoin(catalysts, eq(goldenEggs.catalystId, catalysts.id))
      .leftJoin(watchlist, eq(watchlist.eggId, goldenEggs.id))
      .orderBy(desc(goldenEggs.confidence), desc(goldenEggs.createdAt))
      .limit(opts.limit ?? 200)
      .all();

    return rows
      .filter((r) => opts.minConfidence == null || r.egg.confidence >= opts.minConfidence)
      .filter((r) => opts.sector == null || r.egg.sector === opts.sector)
      .map((r) => ({
        ...r.egg,
        catalyst: r.catalyst
          ? {
              id: r.catalyst.id,
              title: r.catalyst.title,
              theme: r.catalyst.theme,
              canonicalTheme: r.catalyst.canonicalTheme,
              sourceUrl: r.catalyst.sourceUrl,
            }
          : { id: 0, title: "(missing)", theme: "", canonicalTheme: null, sourceUrl: null },
        onWatchlist: r.watchId != null,
      })) as GoldenEggWithCatalyst[];
  }
  async getEggsForCatalyst(catalystId: number) {
    return db
      .select()
      .from(goldenEggs)
      .where(eq(goldenEggs.catalystId, catalystId))
      .orderBy(desc(goldenEggs.confidence))
      .all();
  }
  async getEgg(id: number) {
    const row = db
      .select({ egg: goldenEggs, catalyst: catalysts, watchId: watchlist.id })
      .from(goldenEggs)
      .leftJoin(catalysts, eq(goldenEggs.catalystId, catalysts.id))
      .leftJoin(watchlist, eq(watchlist.eggId, goldenEggs.id))
      .where(eq(goldenEggs.id, id))
      .get();
    if (!row) return undefined;
    return {
      ...row.egg,
      catalyst: row.catalyst
        ? {
            id: row.catalyst.id,
            title: row.catalyst.title,
            summary: row.catalyst.summary,
            theme: row.catalyst.theme,
            sourceType: row.catalyst.sourceType,
            sourceUrl: row.catalyst.sourceUrl,
            strengthScore: row.catalyst.strengthScore,
            firstSeenAt: row.catalyst.firstSeenAt,
            lastSeenAt: row.catalyst.lastSeenAt,
          }
        : null,
      onWatchlist: row.watchId != null,
    } as any;
  }
  async updateEggPrice(id: number, price: number, refreshedAt: number) {
    db.update(goldenEggs)
      .set({ currentPrice: price, priceRefreshedAt: refreshedAt })
      .where(eq(goldenEggs.id, id))
      .run();
  }
  async updateEggFlagPrice(id: number, price: number, flagDate: number) {
    db.update(goldenEggs)
      .set({ priceAtFlag: price, priceAtFlagDate: flagDate })
      .where(eq(goldenEggs.id, id))
      .run();
  }
  async listAllEggs() {
    return db.select().from(goldenEggs).all();
  }

  // Watchlist
  async addToWatchlist(w: InsertWatchlist) {
    return db.insert(watchlist).values(w).returning().get();
  }
  async removeFromWatchlist(eggId: number) {
    db.delete(watchlist).where(eq(watchlist.eggId, eggId)).run();
  }
  async listWatchlist() {
    const rows = db
      .select({ egg: goldenEggs, catalyst: catalysts, watch: watchlist })
      .from(watchlist)
      .leftJoin(goldenEggs, eq(watchlist.eggId, goldenEggs.id))
      .leftJoin(catalysts, eq(goldenEggs.catalystId, catalysts.id))
      .orderBy(desc(watchlist.addedAt))
      .all();
    return rows
      .filter((r) => r.egg)
      .map((r) => ({
        ...r.egg!,
        catalyst: r.catalyst
          ? {
              id: r.catalyst.id,
              title: r.catalyst.title,
              theme: r.catalyst.theme,
              canonicalTheme: r.catalyst.canonicalTheme,
              sourceUrl: r.catalyst.sourceUrl,
            }
          : { id: 0, title: "(missing)", theme: "", canonicalTheme: null, sourceUrl: null },
        onWatchlist: true,
      })) as GoldenEggWithCatalyst[];
  }
  async isOnWatchlist(eggId: number) {
    const r = db.select().from(watchlist).where(eq(watchlist.eggId, eggId)).get();
    return !!r;
  }

  // Daily closes
  async putDailyCloses(rows: InsertDailyClose[]) {
    if (rows.length === 0) return 0;
    // One transaction for the whole day's batch — thousands of single-row
    // inserts would otherwise each pay an fsync.
    const insert = db
      .insert(dailyCloses)
      .values({
        ticker: sql.placeholder("ticker"),
        date: sql.placeholder("date"),
        close: sql.placeholder("close"),
      })
      .onConflictDoNothing()
      .prepare();
    let written = 0;
    db.transaction(() => {
      for (const r of rows) {
        insert.run({ ticker: r.ticker, date: r.date, close: r.close });
        written++;
      }
    });
    return written;
  }
  async getDailyCloses(ticker: string, fromYmd: string, toYmd: string) {
    return db
      .select({ date: dailyCloses.date, close: dailyCloses.close })
      .from(dailyCloses)
      .where(
        and(
          eq(dailyCloses.ticker, ticker.trim().toUpperCase()),
          gte(dailyCloses.date, fromYmd),
          lte(dailyCloses.date, toYmd)
        )
      )
      .orderBy(asc(dailyCloses.date))
      .all();
  }
  async listCachedCloseDates() {
    return db
      .selectDistinct({ date: dailyCloses.date })
      .from(dailyCloses)
      .all()
      .map((r) => r.date);
  }
  async getClosesSince(fromYmd: string) {
    // One query for every ticker, so a page of sparklines is a single request
    // rather than one per card.
    const rows = db
      .select({ ticker: dailyCloses.ticker, date: dailyCloses.date, close: dailyCloses.close })
      .from(dailyCloses)
      .where(gte(dailyCloses.date, fromYmd))
      .orderBy(asc(dailyCloses.ticker), asc(dailyCloses.date))
      .all();
    const out: Record<string, { date: string; close: number }[]> = {};
    for (const r of rows) {
      (out[r.ticker] ??= []).push({ date: r.date, close: r.close });
    }
    return out;
  }

  // Price alerts
  async createAlert(a: InsertPriceAlert) {
    return db.insert(priceAlerts).values(a).returning().get();
  }
  async getOpenAlert(eggId: number, direction: string) {
    return db
      .select()
      .from(priceAlerts)
      .where(
        and(
          eq(priceAlerts.eggId, eggId),
          eq(priceAlerts.direction, direction),
          isNull(priceAlerts.acknowledgedAt)
        )
      )
      .get();
  }
  async listAlerts(limit = 50) {
    const rows = db
      .select({ alert: priceAlerts, egg: goldenEggs })
      .from(priceAlerts)
      .leftJoin(goldenEggs, eq(priceAlerts.eggId, goldenEggs.id))
      .orderBy(desc(priceAlerts.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      ...r.alert,
      ticker: r.egg?.ticker ?? "—",
      companyName: r.egg?.companyName ?? "(deleted egg)",
    })) as PriceAlertWithEgg[];
  }
  async acknowledgeAlert(id: number, ts: number) {
    db.update(priceAlerts).set({ acknowledgedAt: ts }).where(eq(priceAlerts.id, id)).run();
  }
  async acknowledgeAllAlerts(ts: number) {
    return db.update(priceAlerts).set({ acknowledgedAt: ts }).where(isNull(priceAlerts.acknowledgedAt)).run()
      .changes;
  }

  // Ripple cache
  async getCache(themeHash: string) {
    return db.select().from(rippleCache).where(eq(rippleCache.themeHash, themeHash)).get();
  }
  async putCache(c: InsertRippleCache) {
    return db.insert(rippleCache).values(c).returning().get();
  }
  async incrementCacheHit(id: number) {
    db.update(rippleCache)
      .set({ hitCount: sql`${rippleCache.hitCount} + 1` })
      .where(eq(rippleCache.id, id))
      .run();
  }
  async deleteCache(themeHash: string) {
    db.delete(rippleCache).where(eq(rippleCache.themeHash, themeHash)).run();
  }
  async sweepExpiredCache(nowTs: number) {
    // Rows with a null expiresAt predate the TTL column — leave them alone
    // rather than silently discarding cached work.
    const res = db
      .delete(rippleCache)
      .where(and(isNotNull(rippleCache.expiresAt), lt(rippleCache.expiresAt, nowTs)))
      .run();
    return res.changes;
  }

  // Scan runs
  async tryStartScanRun(nowTs: number, staleMs: number) {
    // better-sqlite3 is synchronous, so this whole check-and-insert runs as one
    // atomic transaction — no window for two concurrent requests to both start
    // a scan (and both spend credits).
    return db.transaction((tx): { ok: true; run: ScanRun } | { ok: false; running: ScanRun } => {
      // There may be MORE than one "running" row (e.g. an abandoned run from a
      // previous crash alongside a live one), so inspect them all: block if any
      // is still fresh, and only then clean up the stale ones. Reading a single
      // arbitrary row here would let a live scan slip through.
      const runningRows = tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.status, "running"))
        .orderBy(desc(scanRuns.startedAt))
        .all();

      const live = runningRows.find((r) => nowTs - r.startedAt < staleMs);
      if (live) return { ok: false, running: live };

      // Every running row is older than staleMs: those processes died mid-scan.
      // Force-fail them all rather than letting them block scanning forever.
      for (const r of runningRows) {
        tx.update(scanRuns)
          .set({
            status: "error",
            finishedAt: nowTs,
            errorMessage: "abandoned — no completion recorded (server likely restarted mid-scan)",
          })
          .where(eq(scanRuns.id, r.id))
          .run();
      }
      const run = tx
        .insert(scanRuns)
        .values({
          startedAt: nowTs,
          finishedAt: null,
          catalystsIngested: 0,
          catalystsNew: 0,
          eggsCreated: 0,
          cacheHits: 0,
          approxCredits: 0,
          status: "running",
          errorMessage: null,
        })
        .returning()
        .get();
      return { ok: true, run };
    });
  }
  async createScanRun(r: InsertScanRun) {
    return db.insert(scanRuns).values(r).returning().get();
  }
  async finishScanRun(id: number, patch: Partial<ScanRun>) {
    db.update(scanRuns).set(patch).where(eq(scanRuns.id, id)).run();
  }
  async listScanRuns(limit = 20) {
    return db.select().from(scanRuns).orderBy(desc(scanRuns.startedAt)).limit(limit).all();
  }
  async getLatestScanRun() {
    return db.select().from(scanRuns).orderBy(desc(scanRuns.startedAt)).limit(1).get();
  }
}

export const storage = new DatabaseStorage();
