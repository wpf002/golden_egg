/**
 * Centralized, validated environment config.
 *
 * Parsed once at import. `dotenv/config` is loaded first in server/index.ts, so
 * process.env is already populated by the time this module evaluates. Import
 * `env` anywhere you need config; call `validateProviders()` at boot to fail
 * loud on a missing API key instead of lazily at first request.
 */
import { z } from "zod";

const schema = z.object({
  // LLM
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  ANTHROPIC_CHEAP_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_CHEAP_MODEL: z.string().default("gpt-4o-mini"),

  // Quotes (spot prices, gainers)
  QUOTES_PROVIDER: z.enum(["finnhub", "polygon"]).default("finnhub"),
  FINNHUB_API_KEY: z.string().min(1).optional(),

  // Candles (daily closes: backtest, sparklines). Defaults to QUOTES_PROVIDER.
  // Split from quotes because the free tiers are good at opposite things:
  // Finnhub free has real-time quotes but no candles; Polygon free has candles
  // but is EOD-only and rate-limited.
  CANDLES_PROVIDER: z.enum(["finnhub", "polygon"]).optional(),
  POLYGON_API_KEY: z.string().min(1).optional(),
  /** Requests/minute allowed by the Polygon plan (free tier is ~5). */
  POLYGON_RPM: z.coerce.number().int().positive().default(5),

  // Scan cost controls — credits are the scarcest resource, so the per-run
  // ceiling is explicit and configurable rather than a magic number in scan.ts.
  SCAN_MAX_CATALYSTS: z.coerce.number().int().positive().default(25),
  SCAN_MAX_CREDITS: z.coerce.number().int().positive().default(400),

  // Access gate: when set, every /api request must carry this value in the
  // x-access-token header. Empty (the default) disables the gate, so local
  // dev and tests run friction-free; production sets it because the app is
  // on a public URL and a scan spends real credits.
  ACCESS_TOKEN: z.string().default(""),

  // Data
  DB_PATH: z.string().default("./data.db"),

  // Background jobs
  /** Recurring scan schedule, as a standard 5-field schedule expression. Empty disables it. */
  SCAN_SCHEDULE: z.string().default(""),
  /** How often to sweep expired ripple-cache rows, in minutes. */
  CACHE_SWEEP_MINUTES: z.coerce.number().int().positive().default(360),
  /** Alert when a watchlist egg's return-vs-flag moves this far (%), either way. */
  ALERT_THRESHOLD_PCT: z.coerce.number().positive().default(10),
  /** Fact-check new theses with web search before saving eggs (Anthropic only). */
  GROUNDING_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /** Max web searches per grounded theme. */
  GROUNDING_MAX_SEARCHES: z.coerce.number().int().positive().max(20).default(6),
  /** Daily-close cache refresh, as a 5-field schedule expression. Empty disables it. */
  CLOSES_SCHEDULE: z.string().default(""),
  /** How many calendar days back the close backfill covers. */
  CLOSES_BACKFILL_DAYS: z.coerce.number().int().positive().max(365).default(45),

  // Server
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[config] Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration — see errors above.");
}

export const env = parsed.data;
export type Env = typeof env;

/** Candles fall back to the quotes provider unless explicitly split. */
export const candlesProvider = env.CANDLES_PROVIDER ?? env.QUOTES_PROVIDER;

/**
 * Assert that the credentials required by the *selected* providers are present.
 * Call once at startup so a missing key is a boot-time error, not a mid-scan one.
 */
export function validateProviders(): void {
  const missing: string[] = [];
  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (env.LLM_PROVIDER === "openai" && !env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  // A key is required if *either* role uses that provider.
  const usesFinnhub = env.QUOTES_PROVIDER === "finnhub" || candlesProvider === "finnhub";
  const usesPolygon = env.QUOTES_PROVIDER === "polygon" || candlesProvider === "polygon";
  if (usesFinnhub && !env.FINNHUB_API_KEY) missing.push("FINNHUB_API_KEY");
  if (usesPolygon && !env.POLYGON_API_KEY) missing.push("POLYGON_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required env for the selected providers: ${missing.join(", ")}. ` +
        `Set them in .env (see .env.example). LLM_PROVIDER=${env.LLM_PROVIDER}, ` +
        `QUOTES_PROVIDER=${env.QUOTES_PROVIDER}, CANDLES_PROVIDER=${candlesProvider}.`
    );
  }
  console.log(
    `[config] providers OK — llm=${env.LLM_PROVIDER}, quotes=${env.QUOTES_PROVIDER}, candles=${candlesProvider}`
  );
}
