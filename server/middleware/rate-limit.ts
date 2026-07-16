/**
 * Rate limiting.
 *
 * This is a single-user research tool, so the limits are about protecting the
 * wallet and upstream providers from runaway loops / double-clicks — not about
 * defending against a botnet.
 */
import rateLimit from "express-rate-limit";

/** Broad cap on the API surface. Generous: normal dashboard use is bursty. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down." },
});

/**
 * Tight cap for routes that spend LLM credits or fan out to the quotes
 * provider. A scan costs real money; nobody needs to run six a minute.
 */
export const expensiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "This operation is rate-limited (it costs credits). Try again shortly." },
});
