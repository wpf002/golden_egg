/**
 * Title-case for display strings that come out of the database in sentence
 * case ("Armored truck OEMs", "Cannabis / CBD industry").
 *
 * Rules:
 *  - Words that already carry capitals beyond the first letter (OEMs, GLP-1,
 *    CBD, CHIPS, US, AI) are left exactly as written — "fixing" an acronym
 *    is worse than missing one.
 *  - Small connector words (of, and, the, …) stay lowercase unless they lead
 *    or end the phrase.
 *  - Capitalization applies across hyphens and slashes, so
 *    "child-resistant packaging" → "Child-Resistant Packaging".
 */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "vs",
  "via",
]);

export function titleCase(input: string): string {
  if (!input) return input;
  const tokens = input.split(/([\s/-]+)/);
  const isWord = (t: string) => /[a-zA-Z0-9]/.test(t);
  const wordCount = tokens.filter(isWord).length;

  let wordIndex = 0;
  return tokens
    .map((t) => {
      if (!isWord(t)) return t;
      const idx = wordIndex++;
      // Already has capitals past position 0 (OEMs, GLP-1 parts) — hands off.
      if (/[A-Z]/.test(t.slice(1))) return t;
      // All-caps short tokens (AI, US, CBD, CHIPS) — hands off.
      if (/^[A-Z0-9]+$/.test(t)) return t;
      if (idx > 0 && idx < wordCount - 1 && SMALL_WORDS.has(t.toLowerCase())) {
        return t.toLowerCase();
      }
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join("");
}
