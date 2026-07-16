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

  // Quotes / OHLCV
  QUOTES_PROVIDER: z.enum(["finnhub"]).default("finnhub"),
  FINNHUB_API_KEY: z.string().min(1).optional(),

  // Scan cost controls — credits are the scarcest resource, so the per-run
  // ceiling is explicit and configurable rather than a magic number in scan.ts.
  SCAN_MAX_CATALYSTS: z.coerce.number().int().positive().default(25),
  SCAN_MAX_CREDITS: z.coerce.number().int().positive().default(400),

  // Data
  DB_PATH: z.string().default("./data.db"),

  // Background jobs
  /** Recurring scan schedule, as a standard 5-field schedule expression. Empty disables it. */
  SCAN_SCHEDULE: z.string().default(""),
  /** How often to sweep expired ripple-cache rows, in minutes. */
  CACHE_SWEEP_MINUTES: z.coerce.number().int().positive().default(360),

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

/**
 * Assert that the credentials required by the *selected* providers are present.
 * Call once at startup so a missing key is a boot-time error, not a mid-scan one.
 */
export function validateProviders(): void {
  const missing: string[] = [];
  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (env.LLM_PROVIDER === "openai" && !env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (env.QUOTES_PROVIDER === "finnhub" && !env.FINNHUB_API_KEY) missing.push("FINNHUB_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required env for the selected providers: ${missing.join(", ")}. ` +
        `Set them in .env (see .env.example). LLM_PROVIDER=${env.LLM_PROVIDER}, QUOTES_PROVIDER=${env.QUOTES_PROVIDER}.`
    );
  }
  console.log(`[config] providers OK — llm=${env.LLM_PROVIDER}, quotes=${env.QUOTES_PROVIDER}`);
}
