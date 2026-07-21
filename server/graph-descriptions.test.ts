import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NODE_DESCRIPTIONS } from "./graph-descriptions";

describe("graph node descriptions", () => {
  it("are all non-empty and reasonably short", () => {
    for (const [slug, d] of Object.entries(NODE_DESCRIPTIONS)) {
      expect(d.trim().length, slug).toBeGreaterThan(10);
      expect(d.length, slug).toBeLessThan(300);
    }
  });

  it("cover every slug in the seed", () => {
    const src = readFileSync(path.join(__dirname, "seed.ts"), "utf8");
    const slugs = new Set([...src.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]));
    const missing = [...slugs].filter((s) => !NODE_DESCRIPTIONS[s]);
    expect(missing).toEqual([]);
  });
});
