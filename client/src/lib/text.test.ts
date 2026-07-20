import { describe, it, expect } from "vitest";
import { titleCase } from "./text";

describe("titleCase", () => {
  it("capitalizes plain words", () => {
    expect(titleCase("nuclear power resurgence")).toBe("Nuclear Power Resurgence");
    expect(titleCase("hyperscaler capex")).toBe("Hyperscaler Capex");
  });

  it("leaves acronyms and mixed-caps words untouched", () => {
    // These are the real node names from the seed data.
    expect(titleCase("Armored truck OEMs")).toBe("Armored Truck OEMs");
    expect(titleCase("GLP-1 weight loss drugs")).toBe("GLP-1 Weight Loss Drugs");
    expect(titleCase("US reshoring & CHIPS Act")).toBe("US Reshoring & CHIPS Act");
    expect(titleCase("AI Datacenters")).toBe("AI Datacenters");
  });

  it("capitalizes across slashes and hyphens", () => {
    expect(titleCase("Cannabis / CBD industry")).toBe("Cannabis / CBD Industry");
    expect(titleCase("Reduced snack/soda consumption")).toBe("Reduced Snack/Soda Consumption");
    expect(titleCase("Child-resistant packaging")).toBe("Child-Resistant Packaging");
  });

  it("keeps small connector words lowercase in the middle", () => {
    expect(titleCase("cost of capital")).toBe("Cost of Capital");
    expect(titleCase("the price of eggs")).toBe("The Price of Eggs");
  });

  it("handles empty and single-word input", () => {
    expect(titleCase("")).toBe("");
    expect(titleCase("lithium")).toBe("Lithium");
  });
});
