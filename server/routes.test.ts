/**
 * Route-level tests against a REAL (temporary) SQLite database.
 *
 * storage.ts opens env.DB_PATH at import, so pointing DB_PATH at a temp file
 * before importing gives each run an isolated DB with migrations applied — no
 * DI refactor across nine modules required, and the routes are exercised for
 * real (routing, validation, serialization, storage) rather than mocked.
 *
 * Network-touching providers are stubbed: these tests must never hit an API.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "golden-egg-test-"));
process.env.DB_PATH = join(tmp, "test.db");
process.env.FINNHUB_API_KEY = "test-key";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.LOG_LEVEL = "fatal"; // keep test output readable

// Never let a test reach a real provider.
vi.mock("./pipeline/finance", () => ({
  fetchQuotes: vi.fn(async () => ({ AAA: 110 })),
  fetchDailyCloses: vi.fn(async () => []),
  toYmd: (ms: number) => new Date(ms).toISOString().slice(0, 10),
}));

const { registerRoutes } = await import("./routes");
const { storage, sqlite } = await import("./storage");

const app = express();
app.use(express.json());
const httpServer = createServer(app);

let catalystId: number;
let eggId: number;

beforeAll(async () => {
  await registerRoutes(httpServer, app);

  const c = await storage.createCatalyst({
    contentHash: "test-hash-1",
    title: "Test catalyst",
    summary: "summary",
    theme: "Quantum computing",
    sourceType: "rss",
    sourceUrl: "https://example.com",
    strengthScore: 0.6,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    rippleAnalyzed: false,
    rippleCostCredits: 0,
  });
  catalystId = c.id;

  const egg = await storage.createEgg({
    catalystId,
    ticker: "AAA",
    companyName: "Alpha Corp",
    thesis: "t",
    hopDistance: 2,
    confidence: 0.9,
    noveltyScore: 0.7,
    timingLag: "concurrent",
    sector: "Industrials",
    sectorDetail: "Industrials / Cash Logistics",
    ripplePath: JSON.stringify([{ node: "A", relation: "supplies" }]),
    priceAtFlag: 100,
    priceAtFlagDate: Date.now(),
    currentPrice: 110,
    priceRefreshedAt: Date.now(),
    createdAt: Date.now(),
  });
  eggId = egg!.id;
});

afterAll(() => {
  sqlite.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("GET /api/eggs", () => {
  it("returns eggs with the catalyst joined on", async () => {
    const res = await request(app).get("/api/eggs").expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      ticker: "AAA",
      sector: "Industrials",
      sectorDetail: "Industrials / Cash Logistics",
    });
    expect(res.body[0].catalyst.title).toBe("Test catalyst");
  });

  it("filters by sector", async () => {
    await request(app)
      .get("/api/eggs?sector=Industrials")
      .expect(200)
      .expect((r) => {
        expect(r.body).toHaveLength(1);
      });
    await request(app)
      .get("/api/eggs?sector=Healthcare")
      .expect(200)
      .expect((r) => {
        expect(r.body).toHaveLength(0);
      });
  });

  it("filters by minConfidence", async () => {
    const hi = await request(app).get("/api/eggs?minConfidence=0.95").expect(200);
    expect(hi.body).toHaveLength(0);
    const lo = await request(app).get("/api/eggs?minConfidence=0.5").expect(200);
    expect(lo.body).toHaveLength(1);
  });

  it("400s on an out-of-range confidence instead of silently returning everything", async () => {
    await request(app).get("/api/eggs?minConfidence=5").expect(400);
  });

  it("400s on an oversized limit", async () => {
    await request(app).get("/api/eggs?limit=9999").expect(400);
  });
});

describe("GET /api/eggs/:id", () => {
  it("returns the egg", async () => {
    const res = await request(app).get(`/api/eggs/${eggId}`).expect(200);
    expect(res.body.ticker).toBe("AAA");
  });

  it("404s for a missing id", async () => {
    await request(app).get("/api/eggs/999999").expect(404);
  });

  it("400s on a non-numeric id rather than passing NaN to the DB", async () => {
    await request(app).get("/api/eggs/abc").expect(400);
  });

  it("400s on a negative id", async () => {
    await request(app).get("/api/eggs/-1").expect(400);
  });
});

describe("watchlist routes", () => {
  it("adds, lists, and removes", async () => {
    await request(app).post("/api/watchlist").send({ eggId }).expect(200);

    const list = await request(app).get("/api/watchlist").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].ticker).toBe("AAA");
    expect(list.body[0].onWatchlist).toBe(true);

    await request(app).delete(`/api/watchlist/${eggId}`).expect(200);
    const after = await request(app).get("/api/watchlist").expect(200);
    expect(after.body).toHaveLength(0);
  });

  it("400s when eggId is missing from the body", async () => {
    await request(app).post("/api/watchlist").send({}).expect(400);
  });

  it("400s on a non-numeric eggId in the path", async () => {
    await request(app).delete("/api/watchlist/abc").expect(400);
  });
});

describe("GET /api/catalysts", () => {
  it("lists catalysts", async () => {
    const res = await request(app).get("/api/catalysts").expect(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns a catalyst with its egg backlinks", async () => {
    const res = await request(app).get(`/api/catalysts/${catalystId}`).expect(200);
    expect(res.body.title).toBe("Test catalyst");
    expect(res.body.eggs).toHaveLength(1);
  });

  it("404s for a missing catalyst", async () => {
    await request(app).get("/api/catalysts/999999").expect(404);
  });
});

describe("GET /api/graph", () => {
  it("returns nodes and edges", async () => {
    const res = await request(app).get("/api/graph").expect(200);
    expect(res.body).toHaveProperty("nodes");
    expect(res.body).toHaveProperty("edges");
  });
});

describe("alerts routes", () => {
  it("lists (empty) alerts", async () => {
    const res = await request(app).get("/api/alerts").expect(200);
    expect(res.body).toEqual([]);
  });

  it("400s on a non-numeric alert id", async () => {
    await request(app).post("/api/alerts/abc/ack").expect(400);
  });

  it("ack-all is a no-op when there are none", async () => {
    const res = await request(app).post("/api/alerts/ack-all").expect(200);
    expect(res.body.acknowledged).toBe(0);
  });
});

describe("POST /api/scan/run — concurrency guard", () => {
  it("409s when a scan is already running", async () => {
    // Claim the slot directly, then assert the route refuses to start another.
    const claim = await storage.tryStartScanRun(Date.now(), 30 * 60_000);
    expect(claim.ok).toBe(true);

    const res = await request(app).post("/api/scan/run").expect(409);
    expect(res.body.error).toMatch(/already running/i);

    if (claim.ok) await storage.finishScanRun(claim.run.id, { status: "error", finishedAt: Date.now() });
  });
});
