import { describe, it, expect } from "vitest";
import { htmlToText } from "./manual-catalyst";

describe("htmlToText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(htmlToText("<p>Hello   <b>world</b></p>\n<p>Again</p>")).toBe("Hello world Again");
  });

  it("drops script and style content entirely", () => {
    const html =
      "<div>Keep<script>var evil = 1; document.write('x')</script><style>.a{color:red}</style>This</div>";
    const out = htmlToText(html);
    expect(out).toContain("Keep");
    expect(out).toContain("This");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("color:red");
  });

  it("decodes the common entities", () => {
    expect(htmlToText("<p>AT&amp;T &lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;end</p>")).toBe(
      `AT&T <tag> "q" 's' end`
    );
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("   ")).toBe("");
  });

  it("handles multi-line scripts (the greedy-regex trap)", () => {
    const html = `<article>Real text<script type="text/javascript">
      function a() { return "<p>fake</p>"; }
    </script>more real</article>`;
    const out = htmlToText(html);
    expect(out).toContain("Real text");
    expect(out).toContain("more real");
    expect(out).not.toContain("fake");
  });
});
