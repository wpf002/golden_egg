import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { runFullScan, ScanInProgressError } from "./pipeline/scan";
import { insertWatchlistSchema } from "@shared/schema";
import { fetchQuotes, fetchDailyCloses, toYmd } from "./pipeline/finance";
import {
  parseId,
  eggQuerySchema,
  zodMessage,
  manualCatalystSchema,
  exportQuerySchema,
} from "./middleware/validate";
import { addManualCatalyst, ManualCatalystError } from "./pipeline/manual-catalyst";
import { renderMarkdownReport } from "./lib/report";
import { backfillCloses } from "./pipeline/closes";
import { mapWithConcurrency } from "./lib/concurrency";
import { scoreReturn } from "./lib/backtest";
import { evaluateAlerts } from "./pipeline/alerts";
import { env } from "./config";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- Catalysts ----------
  app.get("/api/catalysts", async (_req, res) => {
    try {
      const rows = await storage.listCatalysts(100);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/catalysts/:id", async (req, res) => {
    try {
      const id = parseId(req.params.id, res);
      if (id === null) return;
      const c = await storage.getCatalyst(id);
      if (!c) return res.status(404).json({ error: "not found" });
      const eggs = await storage.getEggsForCatalyst(id);
      res.json({ ...c, eggs });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Golden Eggs ----------
  app.get("/api/eggs", async (req, res) => {
    try {
      const q = eggQuerySchema.safeParse(req.query);
      if (!q.success) return res.status(400).json({ error: zodMessage(q.error) });
      const rows = await storage.listEggs(q.data);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/eggs/:id", async (req, res) => {
    try {
      const id = parseId(req.params.id, res);
      if (id === null) return;
      const egg = await storage.getEgg(id);
      if (!egg) return res.status(404).json({ error: "not found" });
      res.json(egg);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Refresh current prices for ALL eggs (batched by finance connector).
  app.post("/api/prices/refresh", async (_req, res) => {
    try {
      const eggs = await storage.listAllEggs();
      const tickers = Array.from(new Set(eggs.map((e) => e.ticker.toUpperCase())));
      if (tickers.length === 0) return res.json({ refreshed: 0 });
      const prices = await fetchQuotes(tickers);
      const now = Date.now();
      let refreshed = 0;
      for (const e of eggs) {
        const p = prices[e.ticker.toUpperCase()];
        if (Number.isFinite(p)) {
          await storage.updateEggPrice(e.id, p, now);
          // Also backfill priceAtFlag for legacy rows that never got one
          if (e.priceAtFlag == null) {
            await storage.updateEggFlagPrice(e.id, p, e.createdAt);
          }
          refreshed++;
        }
      }
      // Alerts ride along on the refresh the user already triggered: quote data
      // only, so no extra cost and no surprise background traffic.
      const alerts = await evaluateAlerts(env.ALERT_THRESHOLD_PCT);

      res.json({ refreshed, tickers: tickers.length, alertsCreated: alerts.created });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Backtest: for each egg, compute return-since-flag using daily closes.
  // Rolls up win-rate + median return by theme / sector / hop_distance.
  app.post("/api/backtest/run", async (_req, res) => {
    try {
      const eggs = await storage.listEggs({ limit: 500 });
      const uniqueTickers = Array.from(new Set(eggs.map((e) => e.ticker.toUpperCase())));
      const endYmd = toYmd(Date.now());

      // Per-ticker: earliest flag date determines start range
      const startByTicker: Record<string, string> = {};
      for (const e of eggs) {
        const t = e.ticker.toUpperCase();
        const flag = toYmd(e.priceAtFlagDate ?? e.createdAt);
        if (!startByTicker[t] || flag < startByTicker[t]) startByTicker[t] = flag;
      }

      // Fetch daily closes, a few tickers at a time. Sequential meant one
      // round-trip per ticker (~58 of them); Promise.all would trip the
      // provider's rate limit.
      const closesByTicker: Record<string, { date: string; close: number }[]> = {};
      const fetched = await mapWithConcurrency(uniqueTickers, 5, (t) =>
        fetchDailyCloses(t, startByTicker[t], endYmd)
      );
      uniqueTickers.forEach((t, i) => {
        closesByTicker[t] = fetched[i];
      });

      // Providers whose free tier excludes historical candles (Finnhub) return
      // nothing here. Rather than a blank backtest, fall back to the stored spot
      // price and tell the client the returns are approximate.
      const haveCandles = Object.values(closesByTicker).some((rows) => rows.length > 0);

      // Per-egg return
      type Row = {
        eggId: number;
        ticker: string;
        companyName: string;
        theme: string;
        sector: string | null;
        hopDistance: number;
        confidence: number;
        flagDate: string;
        flagClose: number | null;
        latestClose: number | null;
        returnPct: number | null;
        daysHeld: number;
        /** Flag price looks corrupt; excluded from the rollups. */
        suspect: boolean;
      };
      const rows: Row[] = [];
      for (const e of eggs) {
        const t = e.ticker.toUpperCase();
        const closes = closesByTicker[t] || [];
        const flagDate = toYmd(e.priceAtFlagDate ?? e.createdAt);
        // find first close on or after flagDate
        const {
          flagClose: startClose,
          latestClose,
          returnPct,
          suspect,
        } = scoreReturn({
          closes,
          flagDate,
          priceAtFlag: e.priceAtFlag,
          currentPrice: e.currentPrice,
        });
        const daysHeld = Math.max(
          0,
          Math.floor((Date.now() - (e.priceAtFlagDate ?? e.createdAt)) / 86400_000)
        );
        rows.push({
          eggId: e.id,
          ticker: t,
          companyName: e.companyName,
          theme: e.catalyst.theme,
          sector: e.sector ?? null,
          hopDistance: e.hopDistance,
          confidence: e.confidence,
          flagDate,
          flagClose: startClose,
          latestClose,
          returnPct,
          daysHeld,
          suspect,
        });
      }

      // Roll-ups
      function rollup(key: (r: Row) => string): Array<{
        key: string;
        count: number;
        wins: number;
        winRate: number;
        medianReturn: number | null;
        avgReturn: number | null;
      }> {
        const buckets = new Map<string, Row[]>();
        for (const r of rows) {
          if (r.returnPct == null) continue;
          const k = key(r) || "\u2014";
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(r);
        }
        return Array.from(buckets.entries())
          .map(([k, arr]) => {
            const returns = arr.map((r) => r.returnPct!).sort((a, b) => a - b);
            const wins = returns.filter((v) => v > 0).length;
            const median = returns.length ? returns[Math.floor(returns.length / 2)] : null;
            const avg = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null;
            return {
              key: k,
              count: arr.length,
              wins,
              winRate: returns.length ? wins / returns.length : 0,
              medianReturn: median,
              avgReturn: avg,
            };
          })
          .sort((a, b) => b.count - a.count);
      }

      const byTheme = rollup((r) => r.theme);
      const bySector = rollup((r) => r.sector ?? "Unknown");
      const byHop = rollup((r) => `hop-${r.hopDistance}`);

      // Overall
      const withReturns = rows.filter((r) => r.returnPct != null);
      const overall = withReturns.length
        ? {
            count: withReturns.length,
            wins: withReturns.filter((r) => r.returnPct! > 0).length,
            winRate: withReturns.filter((r) => r.returnPct! > 0).length / withReturns.length,
            medianReturn: [...withReturns].map((r) => r.returnPct!).sort((a, b) => a - b)[
              Math.floor(withReturns.length / 2)
            ],
            avgReturn: withReturns.reduce((s, r) => s + r.returnPct!, 0) / withReturns.length,
          }
        : null;

      res.json({
        rows,
        byTheme,
        bySector,
        byHop,
        overall,
        generatedAt: Date.now(),
        // "close" = real daily closes; "spot" = last refreshed quote, because
        // the configured provider's plan doesn't include historical candles.
        priceSource: haveCandles ? "close" : "spot",
        // Rows dropped from scoring because their flag price looks corrupt.
        suspectCount: rows.filter((r) => r.suspect).length,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Graph ----------
  app.get("/api/graph", async (_req, res) => {
    try {
      const [nodes, edges] = await Promise.all([storage.listNodes(), storage.listAllEdges()]);
      res.json({ nodes, edges });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Watchlist ----------
  app.get("/api/watchlist", async (_req, res) => {
    try {
      res.json(await storage.listWatchlist());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/watchlist", async (req, res) => {
    try {
      const body = insertWatchlistSchema.parse({ ...req.body, addedAt: Date.now() });
      const w = await storage.addToWatchlist(body);
      res.json(w);
    } catch (e) {
      res.status(400).json({ error: zodMessage(e) });
    }
  });

  app.delete("/api/watchlist/:eggId", async (req, res) => {
    try {
      const eggId = parseId(req.params.eggId, res, "eggId");
      if (eggId === null) return;
      await storage.removeFromWatchlist(eggId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Manual catalyst ----------
  app.post("/api/catalysts/manual", async (req, res) => {
    try {
      const body = manualCatalystSchema.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: zodMessage(body.error) });
      const result = await addManualCatalyst(body.data);
      res.status(result.status === "created" ? 201 : 200).json(result);
    } catch (e) {
      if (e instanceof ManualCatalystError) {
        return res.status(e.status).json({ error: e.message });
      }
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Daily-close cache ----------
  // Populating this is what makes the backtest and sparklines usable on a
  // rate-limited plan: one request per DAY covers every ticker at once.
  app.post("/api/closes/backfill", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 40);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: "days must be an integer between 1 and 365" });
      }
      const result = await backfillCloses(days);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // All cached series in one response, keyed by ticker — a page of sparklines
  // is then one request instead of one per card.
  app.get("/api/sparklines", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 45);
      if (!Number.isInteger(days) || days < 2 || days > 365) {
        return res.status(400).json({ error: "days must be an integer between 2 and 365" });
      }
      const from = toYmd(Date.now() - days * 86_400_000);
      res.json(await storage.getClosesSince(from));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Export ----------
  app.get("/api/export/markdown", async (req, res) => {
    try {
      const q = exportQuerySchema.safeParse(req.query);
      if (!q.success) return res.status(400).json({ error: zodMessage(q.error) });
      const eggs = await storage.listEggs({ limit: 500 });
      const md = renderMarkdownReport(eggs, { topN: q.data.topN ?? 20, sinceDays: q.data.sinceDays });
      res.type("text/markdown; charset=utf-8");
      if (q.data.download) {
        res.setHeader("Content-Disposition", `attachment; filename="golden-egg-${toYmd(Date.now())}.md"`);
      }
      res.send(md);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Price alerts ----------
  app.get("/api/alerts", async (_req, res) => {
    try {
      res.json(await storage.listAlerts(50));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/alerts/:id/ack", async (req, res) => {
    try {
      const id = parseId(req.params.id, res);
      if (id === null) return;
      await storage.acknowledgeAlert(id, Date.now());
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/alerts/ack-all", async (_req, res) => {
    try {
      const acknowledged = await storage.acknowledgeAllAlerts(Date.now());
      res.json({ acknowledged });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Scan runs ----------
  app.get("/api/scans", async (_req, res) => {
    try {
      res.json(await storage.listScanRuns(20));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/scans/latest", async (_req, res) => {
    try {
      res.json((await storage.getLatestScanRun()) ?? null);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/scan/run", async (_req, res) => {
    try {
      const result = await runFullScan();
      res.json(result);
    } catch (e) {
      // A scan is already in flight — 409 rather than starting a second one
      // and double-spending credits.
      if (e instanceof ScanInProgressError) {
        return res.status(409).json({
          error: "A scan is already running. Wait for it to finish before starting another.",
          runId: e.runId,
          startedAt: e.startedAt,
        });
      }
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return httpServer;
}
