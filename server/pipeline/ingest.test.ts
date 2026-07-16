import { describe, it, expect } from "vitest";
import { resolveLink } from "./ingest";

const EIA_FEED = "https://www.eia.gov/rss/press_rss.xml";

describe("resolveLink", () => {
  it("resolves a relative link against the feed host (the real EIA case)", () => {
    // These were stored raw and rendered as dead links in the UI and exports.
    expect(resolveLink("/pressroom/releases/press587.php", EIA_FEED)).toBe(
      "https://www.eia.gov/pressroom/releases/press587.php"
    );
  });

  it("leaves an absolute link untouched", () => {
    expect(resolveLink("https://example.com/a", EIA_FEED)).toBe("https://example.com/a");
  });

  it("resolves a path relative to the feed's directory", () => {
    expect(resolveLink("story.html", "https://www.eia.gov/rss/press_rss.xml")).toBe(
      "https://www.eia.gov/rss/story.html"
    );
  });

  it("trims whitespace (feeds pad links inside CDATA)", () => {
    expect(resolveLink("  /a/b  ", EIA_FEED)).toBe("https://www.eia.gov/a/b");
  });

  it("returns null for empty/missing input rather than a broken href", () => {
    expect(resolveLink(null, EIA_FEED)).toBeNull();
    expect(resolveLink(undefined, EIA_FEED)).toBeNull();
    expect(resolveLink("", EIA_FEED)).toBeNull();
    expect(resolveLink("   ", EIA_FEED)).toBeNull();
  });

  it("preserves query and fragment", () => {
    expect(resolveLink("/a?b=1#c", EIA_FEED)).toBe("https://www.eia.gov/a?b=1#c");
  });
});
