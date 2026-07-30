/**
 * The assistant: chat and recommendations, both answering strictly from the
 * app's own data (see app-context.ts).
 *
 * Two rules shape the prompts here, and they matter more than the wording:
 *
 * 1. Grounding. The brief is the source of truth. If it doesn't contain the
 *    answer, saying so is the correct response — a plausible-sounding number
 *    invented about a real stock is the worst failure this app can produce.
 *
 * 2. No advice. This is a research tool, not an advisor. It explains what the
 *    data shows and what's worth a look; it does not tell anyone to buy, sell,
 *    size a position, or predict a price.
 */
import { getLlm } from "./providers/llm";
import { buildAppContext } from "./app-context";
import { extractJson } from "./ripple-utils";
import { log } from "../logger";

const logger = log("assistant");

const GROUND_RULES = `You are the analyst built into Golden Egg, a screener that traces news catalysts two or three tiers down the supply chain to companies that quietly benefit.

Answer ONLY from the BRIEF below — it is this app's live data.
- If the brief doesn't cover something, say plainly that the app doesn't track it. Never invent tickers, prices, returns or figures.
- Refer to supply-chain depth as first/second/third tier.
- "Calibrated" confidence already blends the model's own confidence with the theme's realized results; prefer it over raw confidence.
- Picks marked "too new to score" have no outcome yet — never describe them as winners or losers.
- You are not a financial adviser. Explain what the data shows; do not recommend buying or selling, predict prices, or suggest position sizes.
- Write like a person: short, concrete, no hype and no filler.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Pure: trim history to the last N turns and cap each message. */
export function trimHistory(history: ChatTurn[], maxTurns = 8): ChatTurn[] {
  return history
    .filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-maxTurns)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));
}

export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<string> {
  const ctx = await buildAppContext();
  const convo = trimHistory(history)
    .map((h) => `${h.role === "user" ? "User" : "You"}: ${h.content}`)
    .join("\n");

  const prompt = `${GROUND_RULES}

===== BRIEF (live app data) =====
${ctx.text}
===== END BRIEF =====
${convo ? `\nConversation so far:\n${convo}\n` : ""}
User: ${question.slice(0, 1000)}

Answer in at most 200 words. Use specific tickers and figures from the brief. Plain prose or short bullets — no headers.`;

  const text = await getLlm().complete(prompt, { tier: "premium", maxTokens: 900 });
  return text.trim();
}

export type Recommendation = {
  title: string;
  detail: string;
  tickers: string[];
  kind: "opportunity" | "risk" | "housekeeping";
};

/** Pure: validate the model's recommendation JSON. */
export function parseRecommendations(parsed: unknown): Recommendation[] {
  const raw = ((parsed as { recommendations?: unknown })?.recommendations ?? []) as Array<
    Record<string, unknown>
  >;
  const out: Recommendation[] = [];
  for (const r of raw.slice(0, 6)) {
    const title = String(r.title ?? "").trim();
    const detail = String(r.detail ?? "").trim();
    const kindRaw = String(r.kind ?? "").trim();
    const kind: Recommendation["kind"] =
      kindRaw === "risk" || kindRaw === "housekeeping" ? kindRaw : "opportunity";
    if (title.length < 4 || detail.length < 20) continue;
    const tickers = Array.isArray(r.tickers)
      ? r.tickers
          .map((t) => String(t).trim().toUpperCase())
          .filter((t) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))
          .slice(0, 5)
      : [];
    out.push({ title: title.slice(0, 120), detail: detail.slice(0, 600), tickers, kind });
  }
  return out;
}

export async function buildRecommendations(): Promise<{ recommendations: Recommendation[]; asOf: number }> {
  const ctx = await buildAppContext();
  const prompt = `${GROUND_RULES}

===== BRIEF (live app data) =====
${ctx.text}
===== END BRIEF =====

Give the user up to 5 things worth their attention right now, ordered by how much they matter. Ground every one in the brief.

Look for:
  - deeper-tier picks whose calibrated confidence and novelty both hold up
  - coattail riders that are cheap for the growth they're putting up
  - themes whose realized results contradict the model's confidence (a risk)
  - anything that needs the user's attention: open alerts, themes with no track record yet

Each item:
  - title: a short phrase, not a sentence
  - detail: 1-2 sentences citing the actual figures from the brief
  - tickers: the relevant tickers, or []
  - kind: "opportunity" | "risk" | "housekeeping"

Return ONLY JSON: {"recommendations":[{"title":"...","detail":"...","tickers":["ABC"],"kind":"opportunity"}]}`;

  try {
    const text = await getLlm().complete(prompt, { tier: "premium", maxTokens: 1600 });
    const recommendations = parseRecommendations(extractJson(text));
    logger.info({ count: recommendations.length }, "recommendations built");
    return { recommendations, asOf: Date.now() };
  } catch (e) {
    logger.warn({ err: e }, "recommendations failed");
    return { recommendations: [], asOf: Date.now() };
  }
}
