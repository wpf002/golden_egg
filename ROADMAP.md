# Golden Egg — Roadmap to a Professional Application

This roadmap is derived from a full read of the actual codebase (not the handoff's
description, which is partly stale). It's ordered so each phase unblocks the next:
**make it run → make it trustworthy → make it maintainable → make it shippable → grow features.**

---

## Where the code actually is today

**Strengths (keep these):**
- Clean, small, legible codebase (~1,800 lines of app source outside generated UI).
- One consistent data layer: TanStack Query + `apiRequest`; no raw `fetch()` in components.
- `strict: true` TypeScript; sensible `.gitignore`; deliberate ingest → cache → ripple → egg pipeline.
- Real credit-saving design: canonical themes + 30-day ripple cache + regex noise prefilter.

**Reality checks that differ from the handoff:**
- LLM calls already use the official `@anthropic-ai/sdk` / `openai` SDKs — **not** the `external-tool` CLI.
- The only real CLI dependency left is the **finance layer** (`finance.ts`, and market-gainers in `ingest.ts`).
- The LLM model IDs are proxy names (`gemini_3_flash`, `claude_sonnet_4_6` in `ripple.ts:21-22`)
  that **do not resolve against real Anthropic/OpenAI endpoints** — this is the #1 run blocker on the LLM side.

**Gaps to a professional app:**
1. Won't run locally (CLI finance dep + invalid model IDs + no key validation).
2. Zero tests, no linter, no formatter, no CI.
3. Auth deps present (`passport`, `express-session`, `supabase`) but **entirely unwired** — dead code.
4. No error boundaries; inconsistent loading/error UI; two swallow-all `catch {}` blocks.
5. Prototype hosting signals: hash routing, relative `base`, SQLite file, `__PORT_5000__` build placeholder.
6. Runtime ad-hoc column migrations instead of real migration files.
7. Scattered `any`, `console.*` logging, no structured logger, no request validation on some routes.
8. No scan scheduling, no concurrency guard (two scans can overlap), no enforced per-run cost ceiling.

---

## Phase 0 — Make it run locally & portably  ✅ *(done 2026-07-09)*

The app couldn't boot a scan. Fixed.

- [x] **Provider abstraction** — `server/pipeline/providers/{llm,quotes}.ts` with interfaces + env-selected
      implementations (`anthropic`, `openai`; `yahoo` via `yahoo-finance2`). `finance.ts` and `ingest.ts`
      market-signals now route through `getQuotes()`; `ripple.ts` through `getLlm()`. External-tool CLI gone.
- [x] **Fix model IDs** — `gemini_3_flash` / `claude_sonnet_4_6` replaced with real, env-configurable IDs
      (`ANTHROPIC_MODEL`, `ANTHROPIC_CHEAP_MODEL`). Verified live: a cheap-tier Anthropic call returns correctly.
- [x] **`.env.example`** — documents every var; a gitignored `.env` holds the working key.
- [x] **Startup env validation** — `server/config.ts` Zod-parses env at boot; `validateProviders()` fails loud
      on a missing key for the selected provider.
- [x] **Kill the `__PORT_5000__` placeholder** — `queryClient.ts` now resolves API base from `VITE_API_BASE`
      (same-origin default).
- [x] **Incidental fixes to make it actually boot on this machine:** added `tsconfig` `target: ES2022`
      (bare `tsc` was failing on a pre-existing ES5 error), gated `reusePort` to Linux (macOS `ENOTSUP`),
      pinned Node via `.nvmrc`/`engines` (`>=20.11`), rebuilt `better-sqlite3`, moved dev port to 5050
      (macOS AirPlay squats on 5000).

*Verified:* `npm run dev` boots, config validates, DB reads work (79 eggs / 54 catalysts), API endpoints
respond and degrade gracefully, and the LLM provider works end-to-end against the real Anthropic API.

**Full scan verified:** ran `POST /api/scan/run` end-to-end (ingest → classify → premium analyze → cache →
egg creation) with real Anthropic calls (~28 credits). Premium tier (`claude-sonnet-5`) confirmed to return
real eggs via a direct probe. Also fixed a latent bug: empty ripple outputs were being cached for 30 days
(poisoning a theme); now only non-empty results are cached.

**Live quotes — done & verified:** **Finnhub** is the sole quotes provider (`QUOTES_PROVIDER=finnhub` +
`FINNHUB_API_KEY`); Yahoo was removed entirely (dependency uninstalled, provider deleted) per user preference.
`POST /api/prices/refresh` verified live — refreshed 65 eggs with real prices. Free-tier caveat: real-time
quotes work; **historical candles (backtest) and the gainers screener are paid-only**, so `ohlcv()` and
`marketGainers()` degrade gracefully to empty. Revisit if backtest/market-signal ingest become priorities
(a paid Finnhub tier or Polygon would restore them — drop-in behind the same interface).

---

## Phase 1 — Engineering hygiene  ✅ *(done 2026-07-16)*

Make change safe before adding features.

- [x] **Git** — repo initialized, first commit pushed to `wpf002/golden_egg`.
- [x] **Vitest** — 24 tests across 3 files. Extracted the pure helpers into `ripple-utils.ts` (previously
      untestable: importing `ripple.ts` opened `data.db` at module scope). Covers `coerceToCanonical`
      (incl. the cache-key round-trip invariant that protects credits), `extractJson` (fences/prose/garbage),
      the Finnhub provider (mocked fetch — no network/key), and `toYmd`.
- [x] **ESLint + Prettier** — flat config, 0 errors. Prettier baseline applied across the repo.
      shadcn-generated `ui/` + `use-*` hooks excluded (CLI regenerates them).
- [x] **GitHub Actions** — `.github/workflows/ci.yml`: lint → format → typecheck → test → build on
      every push/PR, pinned to `.nvmrc`. Full sequence verified locally.
- [x] **Purge dead deps** — removed `passport`, `passport-local`, `express-session`, `memorystore`,
      `@supabase/supabase-js`, `ws`, `bufferutil`, `zod-validation-error` + their `@types` (all confirmed
      unreferenced). **Decision: auth was stripped, not built** — revisit only if this goes multi-tenant.
      Trimmed `script/build.ts`'s fictional allowlist (`stripe`, `axios`, `nodemailer`, … never installed).
- [~] **Tame `any`** — errors fixed; 14 `any` warnings remain as a deliberate, visible backlog
      (`no-explicit-any` is `warn`, so new ones surface without failing the build).

**Bugs caught by the new tests/lint (the suite paid for itself immediately):**
- `quotes.ts` filtered tickers with `.filter(Boolean)` *after* `toUpperCase()`, so a whitespace-only
  ticker was truthy and burned an API request on a junk symbol. Fixed with a `trim()`.
- `EggCard.tsx` used a ternary as a statement; `ingest.ts` had a useless regex escape; several dead
  imports across `routes.ts`, `storage.ts`, `seed.ts`, `Graph.tsx`, `EggCard.tsx`.

**Note:** `eslint-plugin-react-hooks@7` imports `zod-validation-error/v4` but allows `^3.5.0`, which npm
resolves to 3.5.4 (no `/v4` subpath) — ESLint won't load at all. Pinned via an `overrides` entry; remove it
once upstream tightens the range.

*Exit criteria met:* green CI on every push; a broken change gets caught automatically.

---

## Phase 2 — Product hardening  ✅ *(done 2026-07-16)*

Make it feel like a product, not a demo.

- [x] **Error boundaries** — `ErrorBoundary` wraps the router inside `AppShell`, so a page crash keeps the
      nav usable instead of blanking the app.
- [x] **Consistent loading/error states** — shared `QueryState.tsx` (`LoadingSkeleton` / `ErrorState` /
      `EmptyState`). Wired into `Overview`, `Graph`, and `Catalysts`, which previously defaulted data to `[]`
      and rendered nothing — a failed fetch was indistinguishable from "no results". Consolidated the
      duplicate local `EmptyState` in `Overview`.
- [x] **Structured logging** — `pino` (pretty in dev, JSON in prod) with secret redaction. Replaced the
      hand-rolled logger that dumped whole JSON response bodies into every log line.
      `config.ts` keeps `console` (the logger imports it — bootstrap ordering); `seed.ts` is a CLI.
- [x] **Request validation** — `middleware/validate.ts`. Routes previously did `Number(req.params.id)` and
      passed `NaN` to the DB; ids and query params are now parsed-or-400.
- [x] **Rate limiting + basic hardening** — `helmet` + `express-rate-limit` (300/min general, 5/min on the
      credit-spending routes). CSP is deliberately off: a real one must be authored against the built Vite
      output — that's Phase 4, not a drive-by default that breaks the app.
- [x] **Scan concurrency guard** — atomic claim in a SQLite transaction (`tryStartScanRun`), 409 on conflict.
      Stale runs (>30 min) are reclaimed so a mid-scan crash can't block scanning forever.
- [x] **Enforced per-run cost ceiling** — `SCAN_MAX_CATALYSTS` / `SCAN_MAX_CREDITS` env knobs replace the
      magic `slice(0, 25)`. The run stops analyzing before it would exceed the budget, reports
      `budgetExhausted`, and defers the rest to the next scan.

**Bug caught while verifying the guard end-to-end** (it shipped broken and testing found it): the first
implementation read a *single arbitrary* `running` row. The live DB had two — an abandoned run from an
earlier crash plus a live one — so it grabbed the stale one, force-failed it, and started a **second
concurrent scan anyway**, spending credits. Now it inspects all running rows, blocks if any is live, and
reclaims every stale one. Pinned by a regression test in `scan-guard.test.ts`.

*Exit criteria met:* errors degrade gracefully; double-spending a scan is blocked (verified 409 live).

**Deferred:** no CORS policy — the API is same-origin only; it becomes relevant if a separate frontend
origin ever ships (Phase 4).

---

## Phase 3 — Data & pipeline maturity  ✅ *(done 2026-07-16)*

- [x] **Real migrations** — Drizzle migration files in `./migrations`, applied at startup by `server/migrate.ts`;
      the unversioned `addColumnIfMissing` hacks are gone. The 0000 baseline is written with `IF NOT EXISTS`
      so the existing `data.db` (built before migrations) adopts cleanly. **Verified both directions on copies:**
      existing DB → 79 eggs / 92 catalysts intact + journal recorded; fresh DB → 7 tables + 13 indexes, and a
      re-run is a clean no-op. A failed migration now refuses to boot rather than serving an unknown schema.
      Also added `DB_PATH` (app + `drizzle.config.ts` read the same value) and `foreign_keys`/`busy_timeout` pragmas.
- [x] **Cache eviction sweep** — `sweepExpiredCache` on a recurring task (`CACHE_SWEEP_MINUTES`, default 6h).
      Legacy rows with a NULL `expiresAt` are deliberately preserved rather than discarded.
- [x] **Scheduled scans** — `server/scheduler.ts` (`SCAN_SCHEDULE`, 5-field expression). **Off by default** —
      scans cost credits, and merely starting the server shouldn't bill you. Reuses the Phase 2 concurrency
      guard (skips if a scan is in flight) and never rethrows from the callback. Graceful shutdown added.
- [x] **Auth decision** — settled in Phase 1: **stripped, not built.** Revisit only if this goes multi-tenant.
- [x] **Batch/parallelize backtest OHLCV** — `mapWithConcurrency` (cap 5) replaces the sequential per-ticker
      loop. Sequential meant ~58 round-trips; `Promise.all` would trip the rate limit.
- [ ] **Postgres option** — **deliberately deferred.** SQLite is correct for a single-user local tool, and
      `IStorage` already isolates the swap. Doing it now would be speculative work with no current pressure.
      Trigger to revisit: real concurrent writers or hosted multi-user.

**Backtest was silently broken and is now fixed.** Finnhub's free plan has no historical candles, so every
`latestClose` was null and the whole backtest returned nothing scoreable. It now falls back to the last
refreshed spot price and reports `priceSource: "spot"`, with a banner saying the returns are approximate —
an honest degradation instead of a blank page.

**Data-integrity bug the backtest surfaced (pre-existing, from the original snapshot):** 6 eggs carry a
placeholder flag price (GEV/FIX/FICO at `$1`, FCNCA at `$2`) against $1,000+ stocks, producing a
**+107,099% "return"** that swamped the averages and inflated the win rate with fake wins. `scoreReturn`
(in `lib/backtest.ts`, extracted so it's testable) now excludes returns beyond ±1000% as corrupt data and
reports `suspectCount` in the UI rather than hiding it. Real effect: win rate 53.2% → **49.3%**, average
return from a garbage number → **0.35%**.

**Follow-up worth doing:** those 6 rows are bad *data*, not just a display problem. A one-off cleanup to null
their `priceAtFlag` (so the next `/api/prices/refresh` backfills a real one) would fix them at the source.
Not done here — it mutates real rows and deserves its own reviewed change.

---

## Phase 4 — Production readiness  *(when you actually decide to ship)*

*(Deliberately last — not to be pursued while the app is still in active development.)*

- [ ] Secrets management (not a plaintext `.env` on disk); rotate the currently-shared Anthropic key.
- [ ] Deployment target + reverse proxy + HTTPS; move off hash routing to real paths if SEO/deep links matter.
- [ ] Observability: error tracking (Sentry), uptime, and a real "credits used" accounting path
      (today's KPI is a directional estimate from `scanRuns.approxCredits`).
- [ ] Backups for the datastore; DR story.
- [ ] Load/cost testing of the scan pipeline.

---

## Phase 5 — Feature roadmap  🟡 *(first wave done 2026-07-16)*

**High value, low credit cost:**
- [x] **Price alerts on watchlist eggs** — new `price_alerts` table (first real incremental migration,
      `0001`). Evaluated during `POST /api/prices/refresh`, which the user already triggers: quote data only,
      **zero credits, and no surprise background traffic**. Dedupes while an alert is unacknowledged, so a
      stock parked past the threshold doesn't re-alert on every check. Skips the known corrupt flag prices.
      Nav badge + panel on Watchlist; `ALERT_THRESHOLD_PCT` (default 10%). Verified live end-to-end against
      real quotes, including the dedupe and acknowledge paths.
- [x] **Sector heatmap on Overview** — cells sized by egg count, shaded by mean confidence; clicking one
      deep-links to a filtered Eggs view. Derived from the existing query cache — zero new backend cost.
- [x] **Inline ripple-path viz in `EggDetailSheet`** — the old flat list read as an unordered set; a ripple is
      directional and ordered, so it now draws the connected chain and marks the terminal tradable ticker.
      Zero backend cost (the data already ships in the egg payload).
- [ ] **Sparklines on `EggCard`** — ⛔ **blocked by the data plan, not by effort.** Needs ~30 daily closes per
      ticker; Finnhub's free tier has no historical candles (`/stock/candle` is paid). The provider interface
      and OHLCV caching are ready — this becomes a small change the moment a candles-capable plan exists.
- [ ] **Backtest "as of" point-in-time mode** — ⛔ **same blocker.** Point-in-time scoring is meaningless
      against spot prices; it needs real historical closes. Deliberately not faked.

**Unblocking both:** a paid Finnhub tier, or Polygon (free tier serves end-of-day candles) behind the
existing `QuotesProvider` interface. That's the single highest-leverage next step for this phase.

**Bug found by actually opening the app in a browser** (it typechecked and tested clean): the corrupt flag
prices guarded in the Phase 3 backtest were still leaking into the main UI — the GEV card rendered
**"+102806.0%"**, which corrodes trust in every other number on screen. `client/src/lib/returns.ts` now
mirrors the server guard, and `EggCard`/`EggDetailSheet` (which each duplicated the delta maths) share it and
show "flag price?" instead of a fake moonshot.

**Also fixed after seeing it rendered:** the heatmap's `confidence * 0.6` tint made every cell the same shade,
because confidences cluster in ~0.70–0.83 — a heatmap that doesn't discriminate is just a list. Now
normalized across the observed min..max.

---

## Phase 6 — Candles provider + data cleanup  🟡 *(2026-07-16)*

- [x] **Polygon provider** — quotes and candles now resolve **separately** (`CANDLES_PROVIDER`), because no
      free tier does both: Finnhub free has real-time quotes but no candles; Polygon free has candles but is
      EOD-only at ~5 req/min. Polygon's `quotes()` uses grouped daily bars — **one** request for all tickers
      rather than one each, which the 5/min cap would otherwise blow — behind a rate limiter. Provider
      contract extracted to `providers/types.ts` so finnhub/polygon depend on the interface, not each other.
      **Needs `POLYGON_API_KEY` to verify against the live API;** 9 mocked tests cover the mapping,
      the ms-vs-seconds epoch trap, and the trading-day walk-back.
- [x] **Canonical sectors** — `CANONICAL_SECTORS` + `coerceToSector`, mirroring the theme coercion.
      **46 → 9 sectors**, nothing fell to "Other". The model's original is preserved in a new `sector_detail`
      column (migration 0002) rather than discarded — "Industrials / Cash Logistics" is real signal. 39 eggs
      keep richer detail, surfaced in the detail sheet.
- [x] **Dedupe eggs** — unique index on `(catalystId, ticker)` (migration 0003). **Correction to an earlier
      claim:** the same ticker across *different* catalysts is legitimate (CEG appears 4× under 4 catalysts,
      each with its own thesis) — only same-catalyst repeats are dupes. The generated migration would have
      failed against existing dupes, so it cleans them first (keeping the lowest id) and clears dependent
      rows. Verified on a copy: 79 → 74 eggs, 5 dupe groups → 0, constraint enforced. `createEgg` uses
      `onConflictDoNothing`; `eggsCreated` counts only real inserts.
- [x] **Route tests** — 20 tests against a real temp DB (`DB_PATH` points at a tmpdir before import), rather
      than a DI refactor across the nine modules that import storage. Verified no test rows leak into `data.db`.
- [x] **Manual "add catalyst"** — paste a URL or text; one cheap-tier call summarizes and places it on a
      canonical theme, then the next scan analyzes it through the usual cache. Dedupes on the source, and the
      classifier declines non-catalysts (verified: it correctly rejected a Wikipedia reference page).
- [x] **Markdown export** — `GET /api/export/markdown?topN=&sinceDays=&download=`. Ranked by
      confidence × novelty, reuses the corrupt-flag guard, no network/credits.
- [x] **Fix corrupt flag prices** — ✅ **done with real data.** With Polygon keyed, `repair-flag-prices.ts`
      read the *true* historical close on each egg's flag date. GEV's `$1` placeholder became its actual
      2026-07-08 close of `$1070.99` (independently verified against Polygon), turning a fake **+102,806%**
      into a real **−3.9%**. **0 corrupt rows remain.** Repaired at the source, not reset.
- [x] **Sparklines** — 30-ish daily closes per `EggCard`, drawn from the local cache. One shared
      `/api/sparklines` request serves the whole page (TanStack dedupes it across cards).
- [x] **Backtest now uses real closes** — `priceSource: "close"`, not the spot fallback. 74/74 eggs scored,
      0 suspect.

### The daily-close cache — the thing that made all of this viable

Polygon's free tier allows ~5 requests/min. A per-ticker series fetch made the backtest take **10+ minutes
for ~50 tickers and time out** — unusable. But Polygon's *grouped* daily bars return **every US ticker for
one day in a single request**, so cost scales with **days tracked, not tickers held**.

So closes are now cached locally (`daily_closes`, migration 0004), populated by grouped bars
(`POST /api/closes/backfill`, plus a scheduled refresh after the US close). Measured:

| | before | after |
|---|---|---|
| Backtest | 10+ min (timed out) | **0.015 s** |
| Price source | `spot` (approximate) | **`close` (real)** |
| Backfill cost | 50 requests (1/ticker) | **13 requests (1/trading day)** — 564 rows, all tickers |

`fetchDailyCloses` deliberately does **not** fall back to a per-ticker call on a cache miss — that's exactly
what made it unusable. A miss means "run the backfill".

**Free-tier split that makes this work:** `QUOTES_PROVIDER=finnhub` (real-time spot, 60/min) +
`CANDLES_PROVIDER=polygon` (daily candles). Polygon's gainers snapshot is 403/paid — the provider degrades
to empty, as designed.

**Bug found while reading the export output:** 8 catalysts had *relative* `source_url`s
("/pressroom/releases/press587.php") from the EIA feed, rendering as dead links in the UI and exports.
`ingest.ts` now resolves item links against the feed URL (`resolveLink`), and a repair script fixed the 8
existing rows — verified the resolved URL returns 200 and that the feed itself declares `www.eia.gov` as base.

**Medium:**
- Manual "add catalyst" flow (paste URL → summarize → queue ripple).
- Weekly top-N export (Notion / Google Docs / Markdown).
- Second-hop lag backtesting (validates the whole parallel-markets thesis empirically).

**High value, high cost — last:**
- Options overlay, live news WebSocket stream, LLM portfolio construction.

---

## Suggested sequencing

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 5 (features)
                                          └─────► Phase 4 (only when shipping)
```

Phase 0 is the gate — nothing else matters until a scan runs locally without the sandbox CLI.
