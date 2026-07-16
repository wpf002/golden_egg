/**
 * Tests for the scan concurrency guard against a real (in-memory) SQLite DB.
 *
 * Regression origin: the first implementation read a single arbitrary "running"
 * row. With both a stale row (from an earlier crash) and a live one present, it
 * picked the stale one, force-failed it, and started a second concurrent scan —
 * double-spending credits. These tests pin that behavior down.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { scanRuns } from "@shared/schema";

const STALE_MS = 30 * 60_000;

// A standalone copy of the guard's logic bound to a test DB. (The production
// method lives on DatabaseStorage, which is hard-wired to ./data.db — decoupling
// that is Phase 3's DI/migrations work.)
function makeGuard(db: ReturnType<typeof drizzle>) {
  return (nowTs: number, staleMs: number) =>
    db.transaction((tx: any) => {
      const runningRows = tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.status, "running"))
        .orderBy(desc(scanRuns.startedAt))
        .all();
      const live = runningRows.find((r: any) => nowTs - r.startedAt < staleMs);
      if (live) return { ok: false as const, running: live };
      for (const r of runningRows) {
        tx.update(scanRuns)
          .set({ status: "error", finishedAt: nowTs, errorMessage: "abandoned" })
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
      return { ok: true as const, run };
    });
}

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let tryStart: ReturnType<typeof makeGuard>;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      catalysts_ingested INTEGER NOT NULL DEFAULT 0,
      catalysts_new INTEGER NOT NULL DEFAULT 0,
      eggs_created INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      approx_credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT
    );
  `);
  db = drizzle(sqlite);
  tryStart = makeGuard(db);
});

function insertRun(startedAt: number, status: string) {
  sqlite.prepare(`INSERT INTO scan_runs (started_at, status) VALUES (?, ?)`).run(startedAt, status);
}

describe("scan concurrency guard", () => {
  it("starts a scan when nothing is running", () => {
    const r = tryStart(NOW, STALE_MS);
    expect(r.ok).toBe(true);
  });

  it("blocks when a live scan is already running", () => {
    insertRun(NOW - 1000, "running");
    const r = tryStart(NOW, STALE_MS);
    expect(r.ok).toBe(false);
  });

  it("REGRESSION: blocks when a live run coexists with a stale one", () => {
    // The original bug: reading one arbitrary row picked the stale run,
    // failed it, and let a second scan start alongside the live one.
    insertRun(NOW - STALE_MS * 2, "running"); // stale, from an old crash
    insertRun(NOW - 1000, "running"); // live — must win
    const r = tryStart(NOW, STALE_MS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.running.startedAt).toBe(NOW - 1000);
  });

  it("reclaims a stale run and starts a new scan", () => {
    insertRun(NOW - STALE_MS - 1, "running");
    const r = tryStart(NOW, STALE_MS);
    expect(r.ok).toBe(true);
    const old = sqlite.prepare("SELECT status FROM scan_runs WHERE id = 1").get() as any;
    expect(old.status).toBe("error");
  });

  it("reclaims ALL stale runs, not just one", () => {
    insertRun(NOW - STALE_MS * 3, "running");
    insertRun(NOW - STALE_MS * 2, "running");
    const r = tryStart(NOW, STALE_MS);
    expect(r.ok).toBe(true);
    const stragglers = sqlite
      .prepare("SELECT COUNT(*) as c FROM scan_runs WHERE status = 'running'")
      .get() as any;
    expect(stragglers.c).toBe(1); // only the newly-created run
  });

  it("ignores finished runs", () => {
    insertRun(NOW - 1000, "success");
    insertRun(NOW - 2000, "error");
    expect(tryStart(NOW, STALE_MS).ok).toBe(true);
  });

  it("a second concurrent claim is rejected", () => {
    expect(tryStart(NOW, STALE_MS).ok).toBe(true);
    expect(tryStart(NOW, STALE_MS).ok).toBe(false); // the first is still running
  });
});
