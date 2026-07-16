/**
 * Pure helpers for the ripple pipeline.
 *
 * Deliberately free of DB/network/config imports so they can be unit-tested
 * without opening data.db or requiring API keys. Keep it that way.
 */
import { CANONICAL_THEMES, CANONICAL_SECTORS } from "@shared/schema";

/**
 * Map a model-supplied theme onto the canonical list. The ripple cache is keyed
 * on this string, so drift here directly costs credits (a near-miss theme name
 * becomes a cache miss and triggers a fresh premium call).
 */
export function coerceToCanonical(raw: string): string {
  // exact match wins
  if ((CANONICAL_THEMES as readonly string[]).includes(raw)) return raw;
  const lower = raw.toLowerCase();
  // fuzzy: first canonical whose key tokens all appear
  for (const c of CANONICAL_THEMES) {
    const toks = c
      .toLowerCase()
      .split(/[\s&/]+/)
      .filter((t) => t.length > 3);
    if (toks.every((t) => lower.includes(t))) return c;
  }
  return raw.slice(0, 60); // fallback — pass through short
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
