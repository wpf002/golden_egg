/**
 * Pure helpers for the ripple pipeline.
 *
 * Deliberately free of DB/network/config imports so they can be unit-tested
 * without opening data.db or requiring API keys. Keep it that way.
 */
import { CANONICAL_THEMES, CANONICAL_SECTORS } from "@shared/schema";

/**
 * Map a model-supplied theme onto the canonical list, or return "" if it isn't
 * one of ours.
 *
 * The ripple cache is keyed on this string, so anything that isn't canonical
 * mints a brand-new key. This used to end with `return raw.slice(0, 60)` — a
 * passthrough — which meant every invented theme became its own cache entry.
 * Net effect: the cache hit **0 times across 6 scans** while 229 credits were
 * spent. Returning "" instead lets callers reject rather than silently
 * fragment the cache.
 *
 * The fuzzy pass deliberately requires ALL of a canonical theme's key tokens.
 * Looser scoring produces false positives that are worse than a miss — token
 * overlap alone mapped "global energy supply chain disruption" onto
 * "Semiconductor supply chain", which would serve semiconductor eggs for an
 * energy catalyst.
 */
export function coerceToCanonical(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "";
  // exact match wins (case-insensitive)
  const exact = (CANONICAL_THEMES as readonly string[]).find(
    (c) => c.toLowerCase() === trimmed.toLowerCase()
  );
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  // fuzzy: first canonical whose key tokens ALL appear
  for (const c of CANONICAL_THEMES) {
    const toks = c
      .toLowerCase()
      .split(/[\s&/]+/)
      .filter((t) => t.length > 3);
    if (toks.length > 0 && toks.every((t) => lower.includes(t))) return c;
  }
  return ""; // not one of ours — the caller must reject, not invent a cache key
}

/**
 * Resolve the classifier's 1-based theme number to a canonical theme.
 *
 * Asking for an index rather than a string removes the whole drift problem: a
 * number either indexes the list or it doesn't. Returns "" when out of range.
 */
export function themeFromId(id: unknown): string {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n < 1 || n > CANONICAL_THEMES.length) return "";
  return CANONICAL_THEMES[n - 1];
}

/**
 * Aliases for sector roots the model actually emits that aren't GICS names.
 * Checked as substrings against the lower-cased root, longest first, so
 * "energy midstream" resolves before a bare "energy" would.
 */
const SECTOR_ALIASES: Array<[pattern: string, canonical: string]> = [
  ["oilfield", "Energy"],
  ["midstream", "Energy"],
  ["energy services", "Energy"],
  ["energy technology", "Energy"],
  ["energy", "Energy"],
  ["marine transportation", "Industrials"],
  ["shipping", "Industrials"],
  ["financial technology", "Financials"],
  ["financial data", "Financials"],
  ["fintech", "Financials"],
  ["financial", "Financials"],
  ["information technology", "Technology"],
  ["technology", "Technology"],
  ["health", "Healthcare"],
  ["utilities", "Utilities"],
  ["utility", "Utilities"],
  ["materials", "Materials"],
  ["industrials", "Industrials"],
  ["industrial", "Industrials"],
  ["real estate", "Real Estate"],
  ["reit", "Real Estate"],
  ["consumer staples", "Consumer Staples"],
  ["consumer discretionary", "Consumer Discretionary"],
  ["communication", "Communication Services"],
];

/**
 * Map a model-supplied sector onto CANONICAL_SECTORS.
 *
 * The model emits things like "Technology / FinTech Compliance" or
 * "Energy Midstream / MLP". The part before the slash is effectively the sector;
 * the remainder is detail we keep elsewhere (goldenEggs.sectorDetail).
 * Unrecognized input becomes "Other" rather than minting a new bucket.
 */
export function coerceToSector(raw: string | null | undefined): string {
  if (!raw) return "Other";
  const trimmed = raw.trim();
  if ((CANONICAL_SECTORS as readonly string[]).includes(trimmed)) return trimmed;

  // "Technology / FinTech Compliance" -> "technology"
  const root = trimmed.split("/")[0].trim().toLowerCase();
  if (!root) return "Other";

  const exact = (CANONICAL_SECTORS as readonly string[]).find((s) => s.toLowerCase() === root);
  if (exact) return exact;

  // Longest alias first so "energy midstream" beats "energy".
  const sorted = [...SECTOR_ALIASES].sort((a, b) => b[0].length - a[0].length);
  for (const [pattern, canonical] of sorted) {
    if (root.includes(pattern)) return canonical;
  }
  return "Other";
}

/**
 * Pull a JSON object out of an LLM response. Models wrap JSON in ```json fences,
 * add prose preambles, or both — so try clean parse, then fence-strip, then a
 * brace-span fallback. Returns null when nothing parses.
 */
export function extractJson(text: string): any {
  if (!text) return null;
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace-span scan */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* unparseable */
    }
  }
  return null;
}
