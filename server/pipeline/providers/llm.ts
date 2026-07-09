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
    return message.content.map((b: any) => (b.type === "text" ? b.text : "")).join("\n");
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
    return resp.choices[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------
// Factory (memoized singleton)
// ---------------------------------------------------------------
let _llm: LlmProvider | null = null;
export function getLlm(): LlmProvider {
  if (_llm) return _llm;
  _llm = env.LLM_PROVIDER === "openai" ? new OpenAIProvider() : new AnthropicProvider();
  return _llm;
}
