import { describe, it, expect } from "vitest";
import { parseProposals } from "./theme-scout";

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
      { proposals: [mk("ok theme one"), mk("ok theme two"), mk("ok theme three"), mk("ok theme four")] },
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
