import { describe, it, expect } from "vitest";
import { trimHistory, parseRecommendations } from "./assistant";
import { parseRiders } from "./coattails";

describe("trimHistory", () => {
  it("keeps only the last N turns", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `q${i}` }));
    const out = trimHistory(many, 4);
    expect(out).toHaveLength(4);
    expect(out[3].content).toBe("q19");
  });

  it("drops malformed entries and caps message length", () => {
    const out = trimHistory([
      { role: "system" as never, content: "ignore me" },
      { role: "user", content: 42 as never },
      { role: "user", content: "x".repeat(5000) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBe(2000);
  });
});

describe("parseRecommendations", () => {
  it("accepts well-formed items and normalizes the kind", () => {
    const out = parseRecommendations({
      recommendations: [
        {
          title: "Nuclear picks untested",
          detail: "Seven picks, none scored yet.",
          tickers: ["bwxt"],
          kind: "risk",
        },
        { title: "Grid theme lagging", detail: "Only 5% of grid picks are up.", kind: "nonsense" },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("risk");
    expect(out[0].tickers).toEqual(["BWXT"]);
    expect(out[1].kind).toBe("opportunity");
  });

  it("drops thin items and junk tickers", () => {
    const out = parseRecommendations({
      recommendations: [
        { title: "hi", detail: "too short" },
        {
          title: "Fine title",
          detail: "A detail long enough to be useful.",
          tickers: ["not a ticker", "OK"],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].tickers).toEqual(["OK"]);
  });

  it("tolerates junk input", () => {
    expect(parseRecommendations(null)).toEqual([]);
    expect(parseRecommendations({})).toEqual([]);
  });
});

describe("parseRiders", () => {
  const ok = {
    ticker: "crdo",
    company_name: "Credo Technology",
    thesis: "Sells the connectivity chips that go inside AI racks.",
    linkage: "supplies interconnect into GPU racks",
    novelty: 0.8,
  };

  it("normalizes the ticker and keeps a complete row", () => {
    const out = parseRiders({ riders: [ok] }, "NVDA");
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe("CRDO");
  });

  it("refuses a rider that is the anchor itself", () => {
    expect(parseRiders({ riders: [{ ...ok, ticker: "NVDA" }] }, "NVDA")).toEqual([]);
  });

  it("dedupes repeats and drops rows missing a thesis or linkage", () => {
    const out = parseRiders(
      { riders: [ok, ok, { ...ok, ticker: "ABC", thesis: "short" }, { ...ok, ticker: "DEF", linkage: "" }] },
      "NVDA"
    );
    expect(out.map((r) => r.ticker)).toEqual(["CRDO"]);
  });

  it("caps the list so one call can't stampede the quote budget", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ok, ticker: `T${i}` }));
    expect(parseRiders({ riders: many }, "NVDA").length).toBeLessThanOrEqual(6);
  });

  it("clamps novelty into range", () => {
    expect(parseRiders({ riders: [{ ...ok, novelty: 9 }] }, "NVDA")[0].novelty).toBe(1);
    expect(parseRiders({ riders: [{ ...ok, novelty: "x" }] }, "NVDA")[0].novelty).toBe(0.5);
  });
});
