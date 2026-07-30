import { describe, it, expect } from "vitest";
import { parseChainNode, slugify, normalizeRelation, chainsToGraph } from "./graph-learn";

describe("parseChainNode", () => {
  it("splits a trailing ticker off a company label", () => {
    expect(parseChainNode("Constellation Energy (CEG)")).toEqual({
      slug: "constellation-energy",
      name: "Constellation Energy",
      kind: "company",
      ticker: "CEG",
    });
  });

  it("handles foreign-listed tickers with a suffix", () => {
    expect(parseChainNode("Gerresheimer (GXI.DE)")?.ticker).toBe("GXI.DE");
  });

  it("treats a bare phrase as an industry node", () => {
    expect(parseChainNode("Grid power")).toEqual({
      slug: "grid-power",
      name: "Grid power",
      kind: "industry",
      ticker: null,
    });
  });

  it("rejects junk that shouldn't become permanent graph state", () => {
    expect(parseChainNode("")).toBeNull();
    expect(parseChainNode("  ")).toBeNull();
    expect(parseChainNode("ab")).toBeNull();
    expect(parseChainNode("—")).toBeNull();
    expect(parseChainNode("1234")).toBeNull();
    expect(parseChainNode("x".repeat(200))).toBeNull();
  });

  it("collapses whitespace so spacing variants share one slug", () => {
    expect(parseChainNode("Grid   power")?.slug).toBe(parseChainNode("Grid power")?.slug);
  });
});

describe("slugify", () => {
  it("normalizes punctuation and ampersands", () => {
    expect(slugify("Cash logistics & armored transport")).toBe("cash-logistics-and-armored-transport");
    expect(slugify("GLP-1 drugs")).toBe("glp-1-drugs");
  });
});

describe("normalizeRelation", () => {
  it("keeps known relations and coerces anything else", () => {
    expect(normalizeRelation("supplies")).toBe("supplies");
    expect(normalizeRelation("USES")).toBe("uses");
    expect(normalizeRelation("increases_compliance_burden_on")).toBe("depends_on");
    expect(normalizeRelation(undefined)).toBe("depends_on");
  });
});

describe("chainsToGraph", () => {
  it("turns a chain into consecutive directed links", () => {
    const { nodes, links } = chainsToGraph([
      [
        { node: "AI Datacenter", relation: "depends_on" },
        { node: "Grid power", relation: "uses" },
        { node: "GE Vernova (GEV)", relation: "supplies" },
      ],
    ]);
    expect([...nodes.keys()].sort()).toEqual(["ai-datacenter", "ge-vernova", "grid-power"]);
    expect(links).toEqual([
      { from: "ai-datacenter", to: "grid-power", relation: "depends_on" },
      { from: "grid-power", to: "ge-vernova", relation: "uses" },
    ]);
    expect(nodes.get("ge-vernova")?.ticker).toBe("GEV");
  });

  it("dedupes identical links across many eggs", () => {
    const path = [{ node: "AI Datacenter", relation: "uses" }, { node: "Grid power" }];
    const { links } = chainsToGraph([path, path, path]);
    expect(links).toHaveLength(1);
  });

  it("skips self-links and too-short paths", () => {
    const { links } = chainsToGraph([
      [{ node: "Grid power" }, { node: "Grid   power" }],
      [{ node: "Only one node" }],
      [],
    ]);
    expect(links).toEqual([]);
  });

  it("prefers the record that carries a ticker when a name appears both ways", () => {
    const { nodes } = chainsToGraph([
      [{ node: "Cameco" }, { node: "Uranium" }],
      [{ node: "Cameco (CCJ)" }, { node: "Uranium" }],
    ]);
    expect(nodes.get("cameco")?.ticker).toBe("CCJ");
    expect(nodes.get("cameco")?.kind).toBe("company");
  });

  it("ignores malformed entries without dropping the rest of the chain", () => {
    const { links } = chainsToGraph([
      [{ node: "AI Datacenter" }, { node: "" }, { node: "Grid power" }, { node: "Vertiv (VRT)" }],
    ]);
    expect(links).toEqual([{ from: "grid-power", to: "vertiv", relation: "depends_on" }]);
  });
});
