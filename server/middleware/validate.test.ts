import { describe, it, expect, vi } from "vitest";
import { parseId, eggQuerySchema, zodMessage } from "./validate";
import { z } from "zod";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("parseId", () => {
  it("accepts a positive integer string", () => {
    const res = mockRes();
    expect(parseId("42", res)).toBe(42);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects non-numeric input with a 400 instead of passing NaN to the DB", () => {
    const res = mockRes();
    expect(parseId("abc", res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it.each(["0", "-1", "1.5", ""])("rejects %j", (raw) => {
    const res = mockRes();
    expect(parseId(raw, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("names the offending param in the error", () => {
    const res = mockRes();
    parseId("nope", res, "eggId");
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("eggId") });
  });
});

describe("eggQuerySchema", () => {
  it("coerces numeric strings from the query string", () => {
    const out = eggQuerySchema.parse({ minConfidence: "0.8", limit: "50" });
    expect(out).toEqual({ minConfidence: 0.8, limit: 50 });
  });

  it("allows an empty query (all filters optional)", () => {
    expect(eggQuerySchema.parse({})).toEqual({});
  });

  it("rejects a confidence outside 0..1", () => {
    expect(eggQuerySchema.safeParse({ minConfidence: "1.5" }).success).toBe(false);
    expect(eggQuerySchema.safeParse({ minConfidence: "-0.1" }).success).toBe(false);
  });

  it("caps limit so a client can't request the whole table", () => {
    expect(eggQuerySchema.safeParse({ limit: "9999" }).success).toBe(false);
  });
});

describe("zodMessage", () => {
  it("flattens zod issues into a readable string", () => {
    const err = z.object({ a: z.number() }).safeParse({ a: "x" }).error;
    expect(zodMessage(err)).toContain("a:");
  });

  it("passes through a plain Error message", () => {
    expect(zodMessage(new Error("boom"))).toBe("boom");
  });
});
