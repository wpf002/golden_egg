/**
 * Cache-eviction sweep, against a real in-memory SQLite DB.
 *
 * `expiresAt` existed since v2 but was only ever honoured on read, so expired
 * rows accumulated forever. The important edge case: rows with a NULL expiresAt
 * predate the TTL column and must NOT be swept.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, lt, isNotNull } from "drizzle-orm";
import { rippleCache } from "@shared/schema";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const NOW = 1_800_000_000_000;

function sweep(nowTs: number): number {
  return db
    .delete(rippleCache)
    .where(and(isNotNull(rippleCache.expiresAt), lt(rippleCache.expiresAt, nowTs)))
    .run().changes;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ripple_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_hash TEXT NOT NULL UNIQUE,
      theme_summary TEXT NOT NULL,
      output_json TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER
    );
  `);
  db = drizzle(sqlite);
});

function insert(hash: string, expiresAt: number | null) {
  sqlite
    .prepare(
      `INSERT INTO ripple_cache (theme_hash, theme_summary, output_json, model, created_at, expires_at)
       VALUES (?, 't', '{"eggs":[]}', 'm', 0, ?)`
    )
    .run(hash, expiresAt);
}

const count = () => (sqlite.prepare("SELECT COUNT(*) c FROM ripple_cache").get() as any).c;

describe("sweepExpiredCache", () => {
  it("removes rows whose TTL has passed", () => {
    insert("expired", NOW - 1);
    expect(sweep(NOW)).toBe(1);
    expect(count()).toBe(0);
  });

  it("keeps rows that are still fresh", () => {
    insert("fresh", NOW + 86_400_000);
    expect(sweep(NOW)).toBe(0);
    expect(count()).toBe(1);
  });

  it("keeps legacy rows with a NULL expiry rather than discarding cached work", () => {
    insert("legacy", null);
    expect(sweep(NOW)).toBe(0);
    expect(count()).toBe(1);
  });

  it("treats expiry exactly at now as still valid (not yet past)", () => {
    insert("boundary", NOW);
    expect(sweep(NOW)).toBe(0);
  });

  it("sweeps only the expired subset of a mixed table", () => {
    insert("a", NOW - 1000);
    insert("b", NOW + 1000);
    insert("c", null);
    insert("d", NOW - 5);
    expect(sweep(NOW)).toBe(2);
    const left = sqlite
      .prepare("SELECT theme_hash FROM ripple_cache ORDER BY theme_hash")
      .all()
      .map((r: any) => r.theme_hash);
    expect(left).toEqual(["b", "c"]);
  });

  it("is a no-op on an empty table", () => {
    expect(sweep(NOW)).toBe(0);
  });
});
