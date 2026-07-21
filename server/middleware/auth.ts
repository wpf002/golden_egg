/**
 * Shared-secret access gate for the public deployment.
 *
 * Single-user app on a public URL: anyone who finds it could browse the data
 * and — worse — hit "Run Scan Now" and spend real LLM credits. A full account
 * system is overkill for one user, so this is one token, compared in constant
 * time, required on every /api request when configured. The client stores it
 * in localStorage after a one-time prompt.
 */
import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config";

export const requireAccessToken: RequestHandler = (req, res, next) => {
  const expected = env.ACCESS_TOKEN;
  if (!expected) return next();

  const got = req.get("x-access-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return next();

  res.status(401).json({ error: "unauthorized" });
};
