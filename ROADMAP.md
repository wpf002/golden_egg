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

## Phase 1 — Engineering hygiene  *(~2–3 days)*

Make change safe before adding features.

- [ ] **Git** — `git init`, first commit, push to the `wpf002/golden_egg` remote (currently not a repo).
- [ ] **Vitest** — start with the two highest-value units the handoff itself flags:
      `ripple.ts::coerceToCanonical` and the finance markdown-table parser. Add a route smoke test with `supertest`.
- [ ] **ESLint + Prettier** — no lint config exists at all today. Add both; wire a `lint` + `format` script.
- [ ] **`typecheck` in CI** — `tsc --noEmit` already works via `check`; make it a gate.
- [ ] **GitHub Actions** — `lint → typecheck → test → build` on every PR.
- [ ] **Purge dead deps** — remove `passport`, `passport-local`, `express-session`, `memorystore`,
      `@supabase/supabase-js` **unless** Phase 3 auth is committed to. Trim `script/build.ts`'s fictional
      bundle allowlist (`stripe`, `axios`, `nodemailer`, … none are installed).
- [ ] **Tame `any`** — the handful in `Graph.tsx`, `Overview.tsx`, `storage.ts:203`, `ripple.ts`, `ingest.ts`.

*Exit criteria:* green CI on every push; a broken change gets caught automatically.

---

## Phase 2 — Product hardening  *(~2–4 days)*

Make it feel like a product, not a demo.

- [ ] **Error boundaries** — wrap the router; add a fallback UI. None exist today.
- [ ] **Consistent loading/error states** — `Overview`, `Graph`, and the `Catalysts` list render blank while
      loading and have no `isError` UI. Standardize skeleton + error components.
- [ ] **Structured logging** — replace `console.*` with `pino` (leveled, JSON in prod, pretty in dev).
- [ ] **Request validation** — every mutating route validates its body with Zod (some already do; make it uniform).
- [ ] **Rate limiting + basic hardening** — `express-rate-limit` on scan/backtest, `helmet`, CORS policy.
- [ ] **Scan concurrency guard** — reject a new `/api/scan/run` while one is `running` (the scan-runs table
      already tracks status; enforce it). Prevents double credit spend.
- [ ] **Enforced per-run cost ceiling** — the `slice(0, 25)` cap in `scan.ts:34` is the only guard; make the
      budget explicit and configurable, and surface "credits remaining" honestly.

*Exit criteria:* a user hitting an error sees a graceful message; no way to accidentally double-spend credits.

---

## Phase 3 — Data & pipeline maturity  *(~3–5 days)*

- [ ] **Real migrations** — replace `addColumnIfMissing` runtime hacks (`storage.ts:21-34`) with Drizzle
      migration files (`drizzle-kit generate`), committed and run on deploy.
- [ ] **Cache eviction sweep** — `expiresAt` is only checked on read; add a background sweep (noted in the
      handoff appendix as a future need past ~10k rows).
- [ ] **Scheduled scans** — a real recurring pre-market scan job (the app originally ran one). Use a scheduled
      task runner; guard with the Phase 2 concurrency lock.
- [ ] **Auth decision** — *either* build it (recommend Supabase or Clerk) for multi-user watchlists, *or*
      formally strip the dead auth deps. Don't leave it ambiguous. Only needed if this goes multi-tenant.
- [ ] **Postgres option** — SQLite is fine for single-user local, but the storage layer already hides behind
      `IStorage`; add a Postgres implementation when concurrency/hosting demands it.
- [ ] **Batch/parallelize backtest OHLCV** — `routes.ts:90` fetches closes sequentially per ticker; cache daily
      closes (also unlocks sparklines) and parallelize with a concurrency cap.

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

## Phase 5 — Feature roadmap  *(from the handoff, re-prioritized by value/credit)*

**High value, low credit cost — do first:**
- Sparklines on `EggCard` (falls out of Phase 3's OHLCV cache).
- Price alerts on watchlist eggs (quote calls only, no LLM).
- Sector heatmap on Overview (zero new backend cost).
- Inline ripple-path graph in `EggDetailSheet`.
- Backtest "as of" point-in-time mode.

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
