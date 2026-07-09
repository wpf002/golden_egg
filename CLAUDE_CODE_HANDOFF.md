# Golden Egg — Claude Code Handoff Prompt

> Paste everything below the `---` into Claude Code as your opening message.
> The zip includes the working SQLite database (`data.db`), so the app boots
> with real catalysts and eggs already ingested.

---

# Project: Golden Egg — Parallel Markets Trader

You are picking up a mid-flight full-stack project. **Read this entire document before writing any code**, then propose a plan for the next milestone.

## What this app does

Golden Egg is a personal research tool that works like an options trader looking at **ancillary / parallel markets**. It watches emerging catalysts (news, regulatory filings, government feeds, market signals) and traces them 2–3 hops through a supply-chain / dependency graph to find non-obvious "picks and shovels" beneficiaries.

Classic examples of the pattern:
- **CBD legalization → cash-heavy dispensaries → armored transport → truck-parts makers**
- **AI datacenter buildout → GPUs → HBM memory → substrate glass → specialty chemicals**
- **GLP-1 drug boom → injection pens → elastomer plungers → West Pharmaceutical**

The dashboard surfaces these 2nd/3rd-order plays as "golden eggs" — public-market tickers with a thesis, ripple path, confidence score, and price tracking.

## Core constraint from the user

**Credits are the scarcest resource.** The user has explicitly said "I don't want to burn through credits recklessly." Every ingest, every LLM call, every finance call must be justified. Prefer caching, prefiltering, and batching over brute force. This is not a nice-to-have — it's the top design constraint.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS v3 + shadcn/ui + wouter (hash routing) + TanStack Query v5
- **Backend:** Express + Node + Drizzle ORM + better-sqlite3 (synchronous!) + Zod
- **Data:** SQLite file at `./data.db` — schema migrates on startup via `addColumnIfMissing`
- **External APIs (must be replaced when running locally):**
  - **Sandbox `external-tool` CLI** — used server-side for the finance connector (`finance_quotes`, `finance_ohlcv_histories`, `finance_market_gainers`)
  - **LLM SDKs** — `@anthropic-ai/sdk` / `openai` for catalyst classification and ripple analysis
- **Deployment:** Was deployed as a static frontend + Express backend pair via the original hosted sandbox tooling on port 5000. Locally: `npm run dev` (Vite + Express on port 5000).

## Repo layout

```
golden-egg/
├── shared/schema.ts          # Drizzle SQLite tables + Zod insert schemas + CANONICAL_THEMES enum
├── server/
│   ├── index.ts              # Express bootstrap
│   ├── routes.ts             # All /api routes
│   ├── storage.ts            # IStorage interface + startup migrations
│   └── pipeline/
│       ├── ingest.ts         # RSS + finance ingest with regex noise prefilter
│       ├── ripple.ts         # Ripple analysis, graph BFS, theme coercion, cache TTL
│       ├── scan.ts           # Orchestrator: ingest → analyze → egg creation
│       └── finance.ts        # Wraps external-tool CLI for quotes + OHLCV
├── client/src/
│   ├── App.tsx               # Wouter routes (uses useHashLocation!)
│   ├── components/
│   │   ├── AppShell.tsx      # Sidebar nav + page header
│   │   ├── EggCard.tsx       # Golden egg tile with price/delta/watchlist
│   │   ├── EggDetailSheet.tsx  # shadcn Sheet drill-down
│   │   └── Logo.tsx
│   ├── pages/
│   │   ├── Overview.tsx      # KPI cards + top eggs + scan trigger
│   │   ├── Eggs.tsx          # Filtered egg grid
│   │   ├── Catalysts.tsx     # Catalyst list with expandable egg backlinks
│   │   ├── Graph.tsx         # Supply-chain graph viz
│   │   ├── Watchlist.tsx     # Starred eggs
│   │   ├── Backtest.tsx      # Score every flagged egg vs. current close
│   │   └── not-found.tsx
│   └── lib/
│       ├── queryClient.ts    # apiRequest wrapper — always use, never raw fetch
│       └── types.ts          # Frontend type mirrors of schema
├── data.db                   # Working SQLite snapshot (79 eggs, 38 catalysts)
├── package.json
├── vite.config.ts
├── drizzle.config.ts
└── tailwind.config.ts
```

## What's already built (v2, shipped)

**Backend**
- ✅ **Schema:** `catalysts`, `goldenEggs` (with `currentPrice`, `priceAtFlag`, `priceRefreshedAt`), `graphNodes`, `graphEdges`, `rippleCache` (with `expiresAt` for 30-day TTL), `watchlist`, `scanRuns`
- ✅ **16 canonical themes** exported as `CANONICAL_THEMES` enum + `CanonicalTheme` type — every ripple output is coerced to one of these to prevent theme sprawl and let the cache hit
- ✅ **Ingest v2** — regex noise prefilter (`isNoise()` drops executive-move/dividend/split/buyback noise) + RSS feeds from Federal Register, USTR, BLS, DoD Contracts, NRC, FDA + market-gainer signals via `finance_market_gainers`
- ✅ **Ripple v2** — theme-filtered BFS on the graph (depth 3 from seed nodes matching theme tokens, capped at 60 edges), 60-second in-process graph memoization, 30-day cache TTL keyed on canonical theme
- ✅ **Finance helper** — `fetchQuotes(tickers)`, `fetchDailyCloses(ticker, start, end)`, `toYmd(ms)` — parses markdown tables from the sandbox finance connector response
- ✅ **Routes:**
  - `GET /api/eggs` — list with filters
  - `GET /api/eggs/:id` — drill-down (returns egg + full catalyst)
  - `GET /api/catalysts` and `GET /api/catalysts/:id` — the `:id` variant returns eggs backlinks
  - `GET /api/graph` — nodes + edges
  - `GET /api/watchlist` / `POST /api/watchlist` / `DELETE /api/watchlist/:eggId`
  - `POST /api/scan/run` — full pipeline
  - `POST /api/prices/refresh` — batch quote refresh for every egg (also backfills legacy `priceAtFlag`)
  - `POST /api/backtest/run` — daily-close scoring with rollups by theme, sector, hop

**Frontend**
- ✅ **Overview** — KPI cards (eggs, catalysts, cache hits, credits), top parallel plays, recent scan history, run-scan button
- ✅ **Eggs page** — search + sector filter + confidence threshold + sort, grid of `EggCard`s
- ✅ **EggCard** — ticker, company, hop badge, sector, timing lag, novelty, thesis snippet, ripple path preview, confidence bar, price + delta, watchlist star, clickable to open drill-down
- ✅ **EggDetailSheet** — full thesis, prices in a 3-col grid (flag / current / return %), ripple path visualization, source catalyst with link, refresh-prices button
- ✅ **Catalysts page** — expandable rows showing which eggs each catalyst spawned
- ✅ **Graph page** — supply-chain node/edge viz
- ✅ **Backtest page** — one-click scoring with 4-stat header + rollup tables by theme/sector/hop + per-egg table
- ✅ **Watchlist page** — starred eggs with drill-down

**Data snapshot (in `data.db`):**
- 79 golden eggs, 38 catalysts, 3 completed scan runs, ~173 credits used across scans

## The 16 canonical themes

```
AI datacenters, Nuclear / SMR, GLP-1 drugs, Reshoring / onshoring,
Semiconductors, Cannabis (cash economy), EV batteries, Sports betting,
Quantum computing, Defense, Critical minerals, Cybersecurity,
Space economy, Water infrastructure, Aging population, Other
```

New themes should extend this list carefully — every additional theme fragments the cache. Only add one if you have concrete evidence a real catalyst class is being lost.

## Running it locally

**Prereqs:** Node 20+, npm.

```bash
npm install
npm run dev       # starts Express + Vite on port 5000
```

Open http://localhost:5000. The bundled `data.db` gives you real eggs to play with **without running any scan**.

**⚠️ External API dependency:** The finance helper calls an `external-tool` CLI binary that only exists inside the original hosted sandbox. Locally you'll need to **replace it** before running `POST /api/scan/run` or `POST /api/prices/refresh`. See "First things to do" below.

## First things to do (in this order)

### 1. Read the code before touching anything

Read in this order:
1. `shared/schema.ts` — data model + canonical themes
2. `server/pipeline/ingest.ts` — where signals come from
3. `server/pipeline/ripple.ts` — how eggs are born (this is the trickiest file)
4. `server/pipeline/finance.ts` — how external prices are fetched
5. `server/routes.ts` — API surface
6. `client/src/pages/*.tsx` — how the UI consumes it

### 2. Replace the sandbox-specific external calls with something portable

The single biggest local-run blocker is `server/pipeline/finance.ts` and the market-signal call in `ingest.ts`. They shell out to an `external-tool` CLI that isn't on your machine.

**Proposed refactor:**

Create `server/pipeline/providers/` with:
- `llm.ts` — interface `{ complete(prompt, opts): Promise<string> }` — implementations: `anthropic.ts`, `openai.ts`. Pick provider via `LLM_PROVIDER` env var.
- `quotes.ts` — interface `{ quotes(tickers): Promise<Map<string, number>>; ohlcv(ticker, start, end): Promise<{date, close}[]> }` — implementations: `yahoo.ts` (free, unauthenticated via `yahoo-finance2` npm), `polygon.ts` (if user has key). Pick via `QUOTES_PROVIDER` env var.

Wire both through a `.env.example` with commented instructions.

Yahoo Finance via `yahoo-finance2` is a good free default — no auth, decent rate limits, works for both spot quotes and daily bars.

### 3. Run a scan end-to-end locally

Once providers are pluggable, `curl -X POST http://localhost:5000/api/scan/run` should ingest new items, filter noise, hit the LLM for ripple analysis on unanalyzed catalysts, and create eggs. Watch the console — every stage logs credits/counts.

### 4. Then tackle the roadmap below

## Roadmap — where to take this next

Grouped by value-per-credit. Aim to build in this order.

### High-value, low-credit-cost

- **Price alerts** — daily background job scans watchlist eggs, alerts when return-vs-flag crosses configurable thresholds. Uses only quote calls, no LLM.
- **Sparklines on EggCard** — cache last 30 daily closes per egg, render tiny inline chart. One OHLCV call per ticker per day; cache aggressively.
- **Ripple path graph inline** — small D3/vis-network render inside `EggDetailSheet` showing the actual path highlighted on the full graph.
- **Sector heatmap** — Overview page: grid of sectors colored by aggregate confidence × count of active eggs. Zero new backend cost.
- **Backtest "as of" mode** — pick a historical date, filter eggs flagged before that date, score returns only from that flag date through a chosen end date. Enables real point-in-time evaluation.

### Medium-value, medium-cost

- **Manual "add catalyst" flow** — user pastes a URL / article, backend fetches + summarizes + queues ripple analysis. Fills gaps in the automated feeds.
- **Notion / Google Docs export** — dump top-N eggs weekly as a formatted markdown doc.
- **Multi-user auth + saved watchlists** — Supabase or Clerk. Only relevant if this ever becomes multi-tenant.
- **Second-hop backtesting** — when a catalyst hits, measure the lag between the 1st-order name moving and 2nd/3rd-order names moving. Validates the whole "parallel markets" thesis empirically.

### High-value, high-cost — do these last

- **Options overlay** — for each egg, fetch options chain, suggest a 60-day ATM call or vertical spread that matches the thesis timeline. Requires an options data provider.
- **Live news stream** — WebSocket firehose from a real news API; realtime badge updates. Expensive — cache and debounce.
- **LLM-assisted portfolio construction** — take the top 20 eggs, ask an LLM to construct a risk-balanced basket with sizing.

## Non-negotiable engineering rules

These come from the frameworks in use — following them will save you real time:

1. **Wouter routing must use `useHashLocation`** on `<Router>` (not `<Switch>`) — sites are served in iframes; path routing breaks.
2. **Never use raw `fetch()`** in the frontend — always `apiRequest` from `@/lib/queryClient`. Bypassing it will 404 in production.
3. **Never `localStorage` / `sessionStorage` / cookies** — blocked in the sandbox. Use React state or the backend.
4. **better-sqlite3 is synchronous** — terminate queries with `.get()`, `.all()`, or `.run()`. Do NOT destructure `[row] = db.select()...`.
5. **SQLite has no arrays** — store lists as JSON text and parse in code.
6. **`<Router hook={useHashLocation}>` wraps `<Switch>`** — do not pass `hook` to Switch directly.
7. **TanStack Query v5** — object form only: `useQuery({ queryKey, queryFn })`.
8. **Cache invalidation** — after every mutation, `queryClient.invalidateQueries({ queryKey: [...] })`. Query keys are arrays for hierarchical paths: `['/api/eggs', id]` not `` [`/api/eggs/${id}`] ``.
9. **Every interactive element gets a stable `data-testid`** — pattern `{action}-{target}` for buttons/inputs, `{type}-{content}-${id}` for repeated rows.
10. **Never say "cron" to the user** — say "scheduled task" or "recurring task" (this app was originally deployed with a daily pre-market scan).

## Design system

- **Palette:** dark slate background, gold primary accent (`--primary`), emerald-400 for positive deltas, rose-400 for negative
- **Type:** monospace tabular for all numbers, sans for prose, `text-xl` is the max heading size (this is a dashboard, not marketing)
- **Micro-copy tone:** "What ripples are worth trading right now?" — confident, specific, no hype

## What NOT to do

- Don't rip out the pipeline architecture. Ingest → cache-check → ripple analysis → egg creation is deliberate.
- Don't add a new database column without extending `storage.ts`'s `addColumnIfMissing` startup migration.
- Don't add a theme without extending `CANONICAL_THEMES` in `shared/schema.ts` AND the `coerceToCanonical` mapping in `ripple.ts`.
- Don't burn credits on speculative features. Every LLM call needs a cache path.
- Don't fetch quotes one-at-a-time — the finance layer batches; keep it batched.

## Your first task

Propose a concrete plan for step 2 above ("Replace the sandbox-specific external calls with something portable"). Show me:

1. The exact `.env.example` you'd add
2. The `providers/` interface shape
3. Which npm packages you'd add and why
4. A dry-run showing which existing files change and roughly how many lines each

Do not write code yet. Wait for me to approve the plan.

---

## Appendix: known todos and quirks

- Legacy eggs (created before v2) had `priceAtFlag` backfilled from a real-time quote when v2 ran the first refresh, so their `returnPct` starts at 0%. New eggs capture a true flag price in `ripple.ts` during creation.
- `data.db` in the zip includes 79 eggs. Delete it to start fresh — the schema will re-create on boot.
- The `expiresAt` cache column exists but the eviction path is checked on read, not on a background sweep. Fine at current scale; revisit if the table grows past ~10k rows.
- No tests exist. Adding a minimal Vitest suite around `ripple.ts::coerceToCanonical` and the finance markdown-table parser would be high-value.
- The `credits used` KPI on Overview is a rough estimate from `scanRuns.approxCredits` — treat it as directional, not accounting-grade.
