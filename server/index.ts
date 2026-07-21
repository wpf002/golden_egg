import "dotenv/config";
import express, { Response, NextFunction } from "express";
import type { Request } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { validateProviders, env } from "./config";
import { logger } from "./logger";
import { apiLimiter, expensiveLimiter } from "./middleware/rate-limit";
import { requireAccessToken } from "./middleware/auth";
import { startScheduledTasks, stopScheduledTasks } from "./scheduler";

// Fail loud at boot if the selected providers are missing credentials,
// rather than lazily on the first scan/price request.
validateProviders();

const app = express();
// One reverse proxy (Railway/most PaaS) sits in front in production. Without
// this, express-rate-limit rejects the X-Forwarded-For header and every
// client shares the proxy's IP for rate-limiting purposes.
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  helmet({
    // The client is a Vite SPA (inline styles/scripts in dev, hashed assets in
    // prod). A real CSP needs to be authored against the built output — that's
    // a Phase 4 production task, not a drive-by default that breaks the app.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Structured request logging — replaces the hand-rolled logger that dumped
// entire JSON response bodies into the log line.
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      // Only log API traffic; static/vite asset requests are noise.
      ignore: (req) => !req.url?.startsWith("/api"),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);

// Access gate first (when ACCESS_TOKEN is set), then rate limiting: a general
// cap on the API, plus a tighter one on the routes that cost real money
// (LLM credits) or hammer the quotes provider.
app.use("/api", requireAccessToken);
app.use("/api", apiLimiter);
app.use("/api/scan/run", expensiveLimiter);
app.use("/api/backtest/run", expensiveLimiter);
app.use("/api/prices/refresh", expensiveLimiter);
// Spends a cheap-tier LLM call and fetches an arbitrary URL — same treatment.
app.use("/api/catalysts/manual", expensiveLimiter);

(async () => {
  await registerRoutes(httpServer, app);

  // Express hands the error handler whatever was thrown, so `unknown` is the
  // honest type — narrow before touching it.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const e = (err ?? {}) as { status?: number; statusCode?: number; message?: string };
    const status = e.status || e.statusCode || 500;
    const message = e.message || "Internal Server Error";

    req.log?.error({ err }, "unhandled error");

    if (res.headersSent) {
      return next(err);
    }

    // Don't leak internals to the client in production.
    return res.status(status).json({
      error: status >= 500 && env.NODE_ENV === "production" ? "Internal Server Error" : message,
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  httpServer.listen(
    {
      port: env.PORT,
      host: "0.0.0.0",
      // reusePort isn't supported on macOS (ENOTSUP); enable only where it is.
      reusePort: process.platform === "linux",
    },
    () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, "serving");
      startScheduledTasks();
    }
  );

  // Graceful shutdown: stop taking work, then close the listener.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info({ signal }, "shutting down");
      stopScheduledTasks();
      httpServer.close(() => process.exit(0));
      // Don't hang forever on lingering keep-alive connections.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
})();
