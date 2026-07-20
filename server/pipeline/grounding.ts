/**
 * Web grounding — spot-check freshly generated theses against the live web
 * before they become golden eggs.
 *
 * Why: the model writes from training data, which goes stale. This dataset has
 * already produced recommendations for companies that were acquired or taken
 * private. A search-backed check runs once per NEW theme analysis (cache hits
 * inherit the verdicts stored with the cached output), so the cost is bounded
 * by how many genuinely new themes appear.
 *
 * Verdicts are deliberately asymmetric:
 *   - "refuted"   → drop the egg. Requires positive evidence it's wrong
 *                   (ticker no longer trades, core claim contradicted).
 *   - "supported" → keep and mark verified (the badge in the UI).
 *   - "unclear"   → keep, unverified. Absence of confirmation is not evidence
 *                   of error, and dropping on it would gut every niche pick.
 *
 * Anthropic-only (uses the server-side web_search tool). Any failure — feature
 * not enabled on the key, timeout, unparseable reply — degrades to "no
 * verdicts", never to a blocked scan.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config";
import { extractJson } from "./ripple-utils";
import type { RippleOutput } from "./ripple";
import { log } from "../logger";

const logger = log("grounding");

export type GroundingVerdict = {
  ticker: string;
  verdict: "supported" | "refuted" | "unclear";
  note?: string;
};

type Egg = RippleOutput["eggs"][number];

/** Pure: apply verdicts to an egg list. Refuted are dropped, supported marked. */
export function applyGrounding(eggs: Egg[], verdicts: GroundingVerdict[]): { kept: Egg[]; refuted: Egg[] } {
  const byTicker = new Map(verdicts.map((v) => [v.ticker.trim().toUpperCase(), v]));
  const kept: Egg[] = [];
  const refuted: Egg[] = [];
  for (const egg of eggs) {
    const v = byTicker.get(egg.ticker.trim().toUpperCase());
    if (v?.verdict === "refuted") {
      refuted.push(egg);
      continue;
    }
    kept.push({ ...egg, verified: v?.verdict === "supported" ? true : undefined });
  }
  return { kept, refuted };
}

export async function groundEggs(theme: string, eggs: Egg[]): Promise<GroundingVerdict[]> {
  if (!env.GROUNDING_ENABLED || eggs.length === 0) return [];
  if (env.LLM_PROVIDER !== "anthropic" || !env.ANTHROPIC_API_KEY) return [];

  const items = eggs.map((e) => ({
    ticker: e.ticker,
    company: e.company_name,
    claim: e.thesis.slice(0, 300),
  }));

  const prompt = `Fact-check these stock theses for the theme "${theme}". Use web search.

For each item, check two things:
1. Does the ticker still trade on a US exchange under roughly this company name?
   (Watch for acquisitions, take-privates, mergers, and renames.)
2. Is the core factual claim in the thesis accurate today?

Verdicts:
- "refuted": ONLY when you find clear evidence the ticker no longer trades or a
  central factual claim is false. Be strict about this bar.
- "supported": you found evidence backing both the ticker and the core claim.
- "unclear": you couldn't confirm either way. This is a fine answer.

Items:
${JSON.stringify(items, null, 2)}

Return ONLY JSON: {"verdicts":[{"ticker":"...","verdict":"supported|refuted|unclear","note":"one short sentence"}]}`;

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2500,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: env.GROUNDING_MAX_SEARCHES,
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const parsed = extractJson(text);
    const raw = (parsed?.verdicts ?? []) as Array<Record<string, unknown>>;
    const verdicts: GroundingVerdict[] = [];
    for (const v of raw) {
      const verdict = String(v.verdict ?? "");
      if (verdict !== "supported" && verdict !== "refuted" && verdict !== "unclear") continue;
      verdicts.push({
        ticker: String(v.ticker ?? "").toUpperCase(),
        verdict,
        note: v.note ? String(v.note).slice(0, 200) : undefined,
      });
    }
    logger.info(
      {
        theme,
        supported: verdicts.filter((v) => v.verdict === "supported").length,
        refuted: verdicts.filter((v) => v.verdict === "refuted").length,
        unclear: verdicts.filter((v) => v.verdict === "unclear").length,
      },
      "grounding complete"
    );
    return verdicts;
  } catch (e) {
    // Feature not on the key, network trouble, whatever — a scan must never
    // fail because fact-checking couldn't run.
    logger.warn({ err: e, theme }, "grounding unavailable — eggs proceed unverified");
    return [];
  }
}
