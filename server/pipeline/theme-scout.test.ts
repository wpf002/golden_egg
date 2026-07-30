import { describe, it, expect } from "vitest";
import { parseProposals, isDuplicateTheme } from "./theme-scout";

const titles = new Map([
  [1, "FAA clears commercial drone corridor"],
  [2, "Amazon expands drone delivery to 4 states"],
  [3, "Zipline raises drone logistics funding"],
]);

const base = {
  existingThemes: ["AI datacenter buildout", "Quantum computing"],
  priorProposalNames: [] as string[],
  titlesById: titles,
};

describe("parseProposals", () => {
  it("accepts a well-formed proposal and resolves evidence titles", () => {
    const out = parseProposals(
      {
        proposals: [
          { name: "Drone logistics", rationale: "Recurring FAA + delivery signals", catalyst_ids: [1, 2] },
        ],
      },
      base
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Drone logistics");
    expect(out[0].evidence).toEqual([
      "FAA clears commercial drone corridor",
      "Amazon expands drone delivery to 4 states",
    ]);
  });

  it("drops proposals that duplicate an existing theme (case-insensitive)", () => {
    const out = parseProposals(
      { proposals: [{ name: "quantum computing", rationale: "r", catalyst_ids: [1, 2] }] },
      base
    );
    expect(out).toEqual([]);
  });

  it("drops proposals already proposed before", () => {
    const out = parseProposals(
      { proposals: [{ name: "Drone logistics", rationale: "r", catalyst_ids: [1, 2] }] },
      { ...base, priorProposalNames: ["Drone Logistics"] }
    );
    expect(out).toEqual([]);
  });

  it("requires at least two resolvable evidence catalysts", () => {
    const out = parseProposals(
      {
        proposals: [
          { name: "Drone logistics", rationale: "r", catalyst_ids: [1] },
          { name: "Phantom theme", rationale: "r", catalyst_ids: [99, 98] },
        ],
      },
      base
    );
    expect(out).toEqual([]);
  });

  it("rejects degenerate names and caps at three proposals", () => {
    const mk = (name: string) => ({ name, rationale: "r", catalyst_ids: [1, 2] });
    const out = parseProposals(
      {
        proposals: [
          mk("Drone logistics"),
          mk("Undersea cable capacity"),
          mk("Desalination buildout"),
          mk("Rare earth refining"),
        ],
      },
      base
    );
    expect(out).toHaveLength(3);
    expect(parseProposals({ proposals: [mk("ab")] }, base)).toEqual([]);
  });

  it("tolerates junk input", () => {
    expect(parseProposals(null, base)).toEqual([]);
    expect(parseProposals({}, base)).toEqual([]);
    expect(parseProposals({ proposals: [{}] }, base)).toEqual([]);
  });
});

describe("isDuplicateTheme", () => {
  // Every pair below is a REAL repeat the scout produced before near-duplicate
  // detection existed — different strings, same theme, each one minting its own
  // ripple-cache key.
  it.each([
    ["Insurance Agency Consolidation & M&A", "Insurance Agency Consolidation & Distribution"],
    ["Infrastructure Inspection & Imaging Technology", "Subsurface Imaging & Infrastructure Inspection"],
    ["Entertainment M&A & Industry Consolidation", "Media & Entertainment M&A Consolidation"],
    ["FDA Food & Drug Safety Modernization", "Food & Agricultural Safety Modernization"],
    ["Military Training & Readiness Modernization", "Military Readiness & Force Modernization"],
    ["Transfusion & Blood Product Innovation", "Hemostatic & Transfusion Medicine Innovation"],
    ["Aviation & Aircraft Airworthiness Modernization", "Aviation Safety & Airworthiness Compliance"],
  ])("catches %s vs %s", (proposed, existing) => {
    expect(isDuplicateTheme(proposed, [existing])).toBe(true);
  });

  it("catches an exact repeat regardless of case and spacing", () => {
    expect(isDuplicateTheme("  quantum computing ", ["Quantum computing"])).toBe(true);
  });

  it("does not block genuinely different themes", () => {
    const taken = ["AI datacenter buildout", "Cannabis cash logistics", "GLP-1 obesity drugs"];
    expect(isDuplicateTheme("Drone logistics", taken)).toBe(false);
    expect(isDuplicateTheme("Water infrastructure", taken)).toBe(false);
    expect(isDuplicateTheme("Undersea cable capacity", taken)).toBe(false);
  });

  it("ignores filler words when judging overlap", () => {
    // Shares only "modernization" and "systems", both too generic to count.
    expect(isDuplicateTheme("Rail Systems Modernization", ["Grid Systems Modernization"])).toBe(false);
  });

  it("rejects a name made entirely of filler", () => {
    expect(isDuplicateTheme("The Industry Solutions", [])).toBe(true);
  });
});

describe("parseProposals near-duplicate handling", () => {
  it("drops a proposal that repeats an existing theme in different words", () => {
    const titles = new Map([
      [1, "Insurer buys agency"],
      [2, "Broker rollup continues"],
    ]);
    const out = parseProposals(
      {
        proposals: [{ name: "Insurance Agency Consolidation & M&A", rationale: "r", catalyst_ids: [1, 2] }],
      },
      {
        existingThemes: ["Insurance Agency Consolidation & Distribution"],
        priorProposalNames: [],
        titlesById: titles,
      }
    );
    expect(out).toEqual([]);
  });

  it("drops a second proposal that repeats the first in the same batch", () => {
    const titles = new Map([
      [1, "Pipeline inspected"],
      [2, "Bridge scanned"],
    ]);
    const out = parseProposals(
      {
        proposals: [
          { name: "Subsurface Imaging & Infrastructure Inspection", rationale: "r", catalyst_ids: [1, 2] },
          { name: "Infrastructure Inspection & Imaging Technology", rationale: "r", catalyst_ids: [1, 2] },
        ],
      },
      { existingThemes: [], priorProposalNames: [], titlesById: titles }
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Subsurface Imaging & Infrastructure Inspection");
  });
});
