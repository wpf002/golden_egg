/**
 * Company-name sanity check.
 *
 * The model names a company and a ticker; the exchange knows what that ticker
 * actually is. If the two names share nothing, the model has very likely paired
 * a real ticker with the wrong company — the most dangerous kind of
 * hallucination, because the ticker resolves a price and everything downstream
 * looks healthy.
 *
 * Deliberately conservative: we only call a mismatch when the names share ZERO
 * meaningful tokens. Legal-suffix noise (Inc, Corp, Holdings…) is stripped so
 * "West Pharmaceutical Services" matches "West Pharmaceutical Services, Inc."
 * A rename ("CONSOL Energy" → "Core Natural Resources") is correctly a mismatch.
 */
const SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "companies",
  "ltd",
  "limited",
  "plc",
  "holdings",
  "holding",
  "group",
  "the",
  "sa",
  "nv",
  "ag",
  "se",
  "llc",
  "lp",
  "trust",
]);

export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !SUFFIXES.has(t))
  );
}

/** True when the two names plausibly describe the same company. */
export function namesLookAlike(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  // A name that is nothing but suffixes can't be compared — don't reject on it.
  if (ta.size === 0 || tb.size === 0) return true;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}
