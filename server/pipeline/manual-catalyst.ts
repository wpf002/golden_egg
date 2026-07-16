/**
 * Manual "add catalyst" flow.
 *
 * The automated feeds (SEC/RSS) miss things — a paywalled piece, a conference
 * talk, a thesis you formed yourself. This lets you paste a URL or raw text and
 * puts it into the same pipeline everything else goes through.
 *
 * Cost: one cheap-tier LLM call to summarize + pick a canonical theme. The
 * premium ripple analysis still happens on the next scan, through the usual
 * cache — so a manual catalyst on an already-analyzed theme costs nothing extra.
 */
import crypto from "node:crypto";
import { storage } from "../storage";
import { CANONICAL_THEMES } from "@shared/schema";
import type { Catalyst } from "@shared/schema";
import { getLlm } from "./providers/llm";
import { coerceToCanonical, extractJson } from "./ripple-utils";
import { log } from "../logger";

const logger = log("manual-catalyst");

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Strip tags/scripts and collapse whitespace — enough to feed a summarizer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type ManualInput = { url?: string; text?: string; title?: string };

export class ManualCatalystError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ManualCatalystError";
  }
}

async function fetchArticle(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "GoldenEgg/1.0 (research)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ManualCatalystError(`Couldn't fetch that URL: ${(e as Error).message}`, 502);
  }
  if (!res.ok) throw new ManualCatalystError(`That URL returned HTTP ${res.status}`, 502);
  const body = await res.text();
  const text = htmlToText(body);
  if (text.length < 200) {
    throw new ManualCatalystError(
      "That page had almost no readable text (it may be JS-rendered or paywalled). Paste the text instead.",
      422
    );
  }
  return text;
}

type Summary = { title: string; summary: string; theme: string; strength: number; keep: boolean };

async function summarize(content: string, hintTitle?: string): Promise<Summary> {
  const themeList = CANONICAL_THEMES.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const prompt = `Summarize this source as a market CATALYST for a parallel-market ("picks and shovels") screener.

Decide:
  keep: true only if this is a MATERIAL, ripple-generating shift (secular demand, regulation, tech adoption, supply shock). False for company PR, personnel news, routine earnings.
  title: <=120 chars, specific.
  summary: 2-3 sentences on the second-order economic consequence — not a recap.
  theme: EXACTLY one from the canonical list below, verbatim. If nothing fits, keep=false.
  strength: 0-1, how large is the second-order ripple.

CANONICAL THEMES:
${themeList}

${hintTitle ? `Suggested title: ${hintTitle}\n` : ""}SOURCE:
${content.slice(0, 6000)}

Return ONLY JSON: {"keep":bool,"title":"...","summary":"...","theme":"...","strength":0.x}`;

  const text = await getLlm().complete(prompt, { tier: "cheap", maxTokens: 600 });
  const parsed = extractJson(text);
  if (!parsed || typeof parsed.title !== "string") {
    throw new ManualCatalystError("Couldn't summarize that source — the model returned nothing usable.", 502);
  }
  return {
    keep: parsed.keep !== false,
    title: String(parsed.title).slice(0, 200),
    summary: String(parsed.summary ?? "").slice(0, 400),
    theme: coerceToCanonical(String(parsed.theme ?? "")),
    strength: Number.isFinite(parsed.strength) ? Math.max(0, Math.min(1, parsed.strength)) : 0.5,
  };
}

export type ManualResult =
  | { status: "created"; catalyst: Catalyst }
  | { status: "duplicate"; catalyst: Catalyst }
  | { status: "rejected"; reason: string };

/**
 * Turn a URL or pasted text into a queued catalyst.
 * Queued = rippleAnalyzed:false, so the next scan analyzes it normally.
 */
export async function addManualCatalyst(input: ManualInput): Promise<ManualResult> {
  const { url, text, title } = input;
  if (!url && !text) throw new ManualCatalystError("Provide a url or text.");

  const content = text?.trim() ? text.trim() : await fetchArticle(url!);

  // Dedupe on the source itself, so pasting the same link twice is a no-op
  // rather than a second premium analysis later.
  const contentHash = hash(`manual:${url ?? content.slice(0, 500)}`);
  const existing = await storage.getCatalystByHash(contentHash);
  if (existing) {
    await storage.touchCatalyst(existing.id, Date.now());
    return { status: "duplicate", catalyst: existing };
  }

  const s = await summarize(content, title);
  if (!s.keep) {
    return {
      status: "rejected",
      reason: "This doesn't look like a material, ripple-generating catalyst, so it wasn't queued.",
    };
  }
  if (!(CANONICAL_THEMES as readonly string[]).includes(s.theme)) {
    return {
      status: "rejected",
      reason: `The model couldn't place this on a canonical theme (got "${s.theme}"). Adding it would fragment the ripple cache.`,
    };
  }

  const now = Date.now();
  const catalyst = await storage.createCatalyst({
    contentHash,
    title: s.title,
    summary: s.summary,
    theme: s.theme,
    sourceType: "manual",
    sourceUrl: url ?? null,
    strengthScore: s.strength,
    firstSeenAt: now,
    lastSeenAt: now,
    rippleAnalyzed: false, // the next scan picks it up
    rippleCostCredits: 0,
  });
  logger.info({ id: catalyst.id, theme: s.theme }, "manual catalyst queued");
  return { status: "created", catalyst };
}
