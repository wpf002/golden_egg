/**
 * LLM provider abstraction.
 *
 * The ripple pipeline needs one thing from an LLM: turn a prompt into text.
 * Two tiers — "cheap" (tier-1 classifier) and "premium" (ripple reasoning) —
 * map to two model IDs so cost controls stay intact. Pick the backend with
 * LLM_PROVIDER; model IDs come from env, never hardcoded.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { env } from "../../config";
import { LlmTruncatedError } from "./types";

export type LlmTier = "cheap" | "premium";

export interface LlmProvider {
  complete(prompt: string, opts?: { tier?: LlmTier; maxTokens?: number }): Promise<string>;
}

// ---------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------
class AnthropicProvider implements LlmProvider {
  private client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  async complete(prompt: string, opts: { tier?: LlmTier; maxTokens?: number } = {}): Promise<string> {
    const model = opts.tier === "cheap" ? env.ANTHROPIC_CHEAP_MODEL : env.ANTHROPIC_MODEL;
    const message = await this.client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content.map((b: any) => (b.type === "text" ? b.text : "")).join("\n");
    // A cut-off reply is usually unparseable JSON. Surfacing it turns a silent
    // "0 results" (after paying for the call) into an actionable error.
    if (message.stop_reason === "max_tokens") throw new LlmTruncatedError(text.length);
    return text;
  }
}

// ---------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------
class OpenAIProvider implements LlmProvider {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  async complete(prompt: string, opts: { tier?: LlmTier; maxTokens?: number } = {}): Promise<string> {
    const model = opts.tier === "cheap" ? env.OPENAI_CHEAP_MODEL : env.OPENAI_MODEL;
    const resp = await this.client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens ?? 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const choice = resp.choices[0];
    const text = choice?.message?.content ?? "";
    if (choice?.finish_reason === "length") throw new LlmTruncatedError(text.length);
    return text;
  }
}

// ---------------------------------------------------------------
// Factory (memoized singleton)
// ---------------------------------------------------------------
let _llm: LlmProvider | null = null;
export function getLlm(): LlmProvider {
  if (_llm) return _llm;
  // Read the env at call time so tests can flip provider between cases.
  const provider = process.env.LLM_PROVIDER ?? env.LLM_PROVIDER;
  _llm = provider === "openai" ? new OpenAIProvider() : new AnthropicProvider();
  return _llm;
}

/** Test seam: drop the memoized provider so an env change takes effect. */
export function __resetLlm(): void {
  _llm = null;
}
