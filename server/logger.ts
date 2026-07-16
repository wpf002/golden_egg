/**
 * Structured logging.
 *
 * Pretty, human-readable lines in development; newline-delimited JSON in
 * production so logs are machine-parseable by whatever ships them.
 *
 * Use `logger.info({ ...fields }, "message")` — put variables in the object,
 * not interpolated into the string, so they stay queryable.
 */
import pino from "pino";
import { env } from "./config";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
  // Never let a stray secret reach the log stream.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.api_key",
      "*.token",
      "*.ANTHROPIC_API_KEY",
      "*.FINNHUB_API_KEY",
      "*.OPENAI_API_KEY",
    ],
    censor: "[redacted]",
  },
});

/** Child logger for a subsystem, e.g. `log("scan").info("started")`. */
export function log(component: string) {
  return logger.child({ component });
}
