/**
 * Pure helpers for the ripple pipeline.
 *
 * Deliberately free of DB/network/config imports so they can be unit-tested
 * without opening data.db or requiring API keys. Keep it that way.
 */
import { CANONICAL_THEMES } from "@shared/schema";

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
