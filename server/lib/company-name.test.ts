import { describe, it, expect } from "vitest";
import { namesLookAlike, nameTokens } from "./company-name";

describe("nameTokens", () => {
  it("strips legal suffixes and punctuation", () => {
    expect([...nameTokens("West Pharmaceutical Services, Inc.")]).toEqual([
      "west",
      "pharmaceutical",
      "services",
    ]);
  });
});

describe("namesLookAlike", () => {
  it("matches across suffix noise", () => {
    expect(namesLookAlike("West Pharmaceutical Services", "West Pharmaceutical Services, Inc.")).toBe(true);
    expect(namesLookAlike("NVIDIA", "NVIDIA Corp")).toBe(true);
    expect(namesLookAlike("Alphabet Inc", "Alphabet")).toBe(true);
  });

  it("REGRESSION: catches a renamed company (the CONSOL case)", () => {
    // CEIX's listing became Core Natural Resources after the merger — the model
    // still calls it CONSOL Energy. Zero shared tokens => mismatch.
    expect(namesLookAlike("CONSOL Energy", "Core Natural Resources")).toBe(false);
  });

  it("catches a ticker pointing at an unrelated company", () => {
    expect(namesLookAlike("Good Co", "Totally Different Enterprises")).toBe(false);
  });

  it("refuses to reject when one side is all suffixes", () => {
    expect(namesLookAlike("The Group Inc", "Whatever Industries")).toBe(true);
  });
});
