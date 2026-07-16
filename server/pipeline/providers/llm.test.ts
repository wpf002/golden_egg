/**
 * Truncation must be loud.
 *
 * Regression origin: analyzeTheme asked for 4-8 eggs with full theses inside
 * max_tokens:3000. The reply was cut off mid-JSON, extractJson returned null,
 * and the caller reported "0 eggs" — after paying for a premium call. Every
 * scan spent ~28 credits and created nothing, silently.
 */
import { describe, it, expect, vi } from "vitest";
import { LlmTruncatedError } from "./types";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "test-key";

const anthropicCreate = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

const { getLlm, __resetLlm } = await import("./llm");

describe("Anthropic provider", () => {
  it("returns the text on a normal stop", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    __resetLlm();
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"eggs":[]}' }],
      stop_reason: "end_turn",
    });
    expect(await getLlm().complete("p")).toBe('{"eggs":[]}');
  });

  it("REGRESSION: throws when the reply hit the token cap", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    __resetLlm();
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"eggs":[{"ticker":"GNR' }],
      stop_reason: "max_tokens",
    });
    // Silently returning the fragment is what cost real money for zero output.
    await expect(getLlm().complete("p")).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("the error names the cause and the fix", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    __resetLlm();
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "xy" }],
      stop_reason: "max_tokens",
    });
    await expect(getLlm().complete("p")).rejects.toThrow(/token cap.*maxTokens/i);
  });
});

describe("OpenAI provider", () => {
  it("returns the text on a normal stop", async () => {
    process.env.LLM_PROVIDER = "openai";
    __resetLlm();
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
    expect(await getLlm().complete("p")).toBe("ok");
  });

  it("REGRESSION: throws on finish_reason=length", async () => {
    process.env.LLM_PROVIDER = "openai";
    __resetLlm();
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: "cut" }, finish_reason: "length" }],
    });
    await expect(getLlm().complete("p")).rejects.toBeInstanceOf(LlmTruncatedError);
  });
});
