/**
 * Small request-validation helpers.
 *
 * Routes previously did `Number(req.params.id)` and passed NaN straight to the
 * storage layer. These parse-or-400 helpers keep that from reaching the DB.
 */
import type { Response } from "express";
import { z } from "zod";

/** A positive integer route param (`:id`, `:eggId`). */
export const idParamSchema = z.coerce.number().int().positive();

export const eggQuerySchema = z.object({
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  sector: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/**
 * Parse a route param as a positive int. Writes a 400 and returns null when it
 * doesn't parse, so callers can `if (id === null) return;`.
 */
export function parseId(raw: string, res: Response, name = "id"): number | null {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid ${name}: expected a positive integer` });
    return null;
  }
  return parsed.data;
}

/** Format a ZodError into a flat, client-readable message. */
export function zodMessage(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  }
  return (e as Error).message;
}
