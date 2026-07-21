import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { runFullScan, ScanInProgressError } from "./pipeline/scan";
import { insertWatchlistSchema, rollupTheme } from "@shared/schema";
import { fetchQuotes, fetchDailyCloses, toYmd } from "./pipeline/finance";
import {
  parseId,
  eggQuerySchema,
  zodMessage,
  manualCatalystSchema,
  exportQuerySchema,
  backtestQuerySchema,
} from "./middleware/validate";
import { addManualCatalyst, ManualCatalystError } from "./pipeline/manual-catalyst";
import { renderMarkdownReport } from "./lib/report";
import { backfillCloses } from "./pipeline/closes";
import { mapWithConcurrency } from "./lib/concurrency";
import { scoreReturn } from "./lib/backtest";
import { analyzeHopLag, type EggSeries } from "./lib/hop-lag";
import { computeCalibration, calibrate, type OutcomeRow } from "./lib/calibration";
import { evaluateAlerts } from "./pipeline/alerts";
import { env } from "./config";

/**
 * Realized outcome per egg, from the local close cache. Cheap: one indexed
 * query for all closes plus in-memory scoring, so routes can call it per
 * request without a materialized table.
 */
async function buildOutcomeRows(): Promise<{ rows: OutcomeRow[]; byEggId: Map<number, string> }> {
  const eggs = await storage.listEggs({ limit: 500 });
  const from = toYmd(Date.now() - 180 * 86_400_000);
  const closesByTicker = await storage.getClosesSince(from);
  const rows: OutcomeRow[] = [];
  const byEggId = new Map<number, string>();
  for (const e of eggs) {
    const theme = rollupTheme(e.catalyst);
    byEggId.set(e.id, theme);
    // Same rule as the backtest: a pick younger than ~one trading day has no
    // outcome yet, and calibration must not read "hasn't moved" as "lost".
    const tooNew = Date.now() - (e.priceAtFlagDate ?? e.createdAt) < 3 * 86_400_000;
    const { returnPct } = scoreReturn({
      closes: closesByTicker[e.ticker.toUpperCase()] ?? [],
      flagDate: toYmd(e.priceAtFlagDate ?? e.createdAt),
      priceAtFlag: e.priceAtFlag,
      currentPrice: e.currentPrice,
    });
    rows.push({ theme, confidence: e.confidence, returnPct: tooNew ? null : returnPct });
  }
  return { rows, byEggId };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Probe for the client's access gate: the auth middleware runs before this,
  // so a 204 here means "your token works (or no gate is configured)".
  app.get("/api/auth/check", (_req, res) => res.status(204).end());

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
      // Blend each egg's model confidence with its theme's realized track
      // record — see lib/calibration.ts. With no outcome data this is a no-op.
      const { rows: outcomes } = await buildOutcomeRows();
      const cal = computeCalibration(outcomes);
      res.json(
        rows.map((e) => ({
          ...e,
          calibratedConfidence: calibrate(e.confidence, cal.get(rollupTheme(e.catalyst))),
        }))
      );
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
  app.post("/api/backtest/run", async (req, res) => {
    try {
      const q = backtestQuerySchema.safeParse(req.query);
      if (!q.success) return res.status(400).json({ error: zodMessage(q.error) });
      const asOf = q.data.asOf;

      const all = await storage.listEggs({ limit: 500 });
      // Point-in-time: only eggs that had actually been flagged by the cutoff.
      // Including later ones would score picks that didn't exist yet.
      const eggs = asOf ? all.filter((e) => toYmd(e.priceAtFlagDate ?? e.createdAt) <= asOf) : all;
      const excludedByAsOf = all.length - eggs.length;

      const uniqueTickers = Array.from(new Set(eggs.map((e) => e.ticker.toUpperCase())));
      const endYmd = asOf ?? toYmd(Date.now());

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
        /** Flagged less than MIN_SCORING_DAYS ago — listed, but not scored. */
        tooNew: boolean;
      };
      // A pick that hasn't had time to move shouldn't count against the hit
      // rate: a day-old egg sits at 0.0% and reads as a miss when it's really
      // just unscored. Three calendar days ≈ at least one full trading day.
      const MIN_SCORING_DAYS = 3;
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
          asOf,
        });
        // Measure the holding period to the cutoff, not to today — in as-of mode
        // "days held" must mean days as of that date.
        const asOfMs = asOf ? Date.parse(asOf + "T00:00:00Z") : Date.now();
        const daysHeld = Math.max(0, Math.floor((asOfMs - (e.priceAtFlagDate ?? e.createdAt)) / 86400_000));
        rows.push({
          eggId: e.id,
          ticker: t,
          companyName: e.companyName,
          // Canonical pick, not the source feed's label — see rollupTheme.
          theme: rollupTheme(e.catalyst),
          sector: e.sector ?? null,
          hopDistance: e.hopDistance,
          confidence: e.confidence,
          flagDate,
          flagClose: startClose,
          latestClose,
          returnPct,
          daysHeld,
          suspect,
          tooNew: daysHeld < MIN_SCORING_DAYS,
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
          if (r.returnPct == null || r.tooNew) continue;
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
      const byHop = rollup((r) =>
        r.hopDistance === 1 ? "First tier" : r.hopDistance === 2 ? "Second tier" : "Third tier"
      );

      // Overall
      const withReturns = rows.filter((r) => r.returnPct != null && !r.tooNew);
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
        tooNewCount: rows.filter((r) => r.tooNew).length,
        generatedAt: Date.now(),
        // "close" = real daily closes; "spot" = last refreshed quote, because
        // the configured provider's plan doesn't include historical candles.
        priceSource: haveCandles ? "close" : "spot",
        // Rows dropped from scoring because their flag price looks corrupt.
        suspectCount: rows.filter((r) => r.suspect).length,
        // Point-in-time mode: what date we scored as of, and how many eggs were
        // excluded for not existing yet.
        asOf: asOf ?? null,
        excludedByAsOf,
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

  // How each theme's picks have ACTUALLY done, and how that reshapes the
  // model's confidence. The visible half of the feedback loop.
  // ---------- Theme proposals (the scout's output) ----------
  app.get("/api/themes/proposals", async (_req, res) => {
    try {
      const rows = await storage.listThemeProposals(25);
      res.json(rows.map((p) => ({ ...p, evidence: JSON.parse(p.evidence) as string[] })));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/themes/proposals/:id/decide", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const approve = req.body?.approve === true;
      const proposal = await storage.getThemeProposal(id);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") {
        return res.status(409).json({ error: `already ${proposal.status}` });
      }
      const now = Date.now();
      await storage.decideThemeProposal(id, approve ? "approved" : "dismissed", now);
      if (approve) await storage.addCustomTheme(proposal.name, now);
      res.json({ ok: true, status: approve ? "approved" : "dismissed" });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/calibration", async (_req, res) => {
    try {
      const { rows } = await buildOutcomeRows();
      const cal = computeCalibration(rows);
      const out = [...cal.values()]
        .sort((a, b) => b.n - a.n)
        .map((c) => ({
          ...c,
          calibratedExample: calibrate(c.avgModelConfidence, c),
        }));
      res.json(out);
    } catch (e) {
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

  // Second-hop lag: does the 2nd-order name actually move AFTER the 1st-order
  // one? That lag is the app's entire premise, so it's worth measuring.
  app.get("/api/analysis/hop-lag", async (req, res) => {
    try {
      const threshold = Number(req.query.thresholdPct ?? 3);
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
        return res.status(400).json({ error: "thresholdPct must be a number between 0 and 100" });
      }
      const eggs = await storage.listEggs({ limit: 500 });
      const from = toYmd(Date.now() - 120 * 86_400_000);
      const to = toYmd(Date.now());
      const closesByTicker = await storage.getClosesSince(from);

      const series: EggSeries[] = eggs.map((e) => ({
        eggId: e.id,
        ticker: e.ticker.toUpperCase(),
        hopDistance: e.hopDistance,
        flagDate: toYmd(e.priceAtFlagDate ?? e.createdAt),
        closes: (closesByTicker[e.ticker.toUpperCase()] ?? []).filter((c) => c.date <= to),
      }));

      res.json(analyzeHopLag(series, threshold));
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
