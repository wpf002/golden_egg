import type { RipplePath } from "@/lib/types";

/**
 * Renders the catalyst → … → ticker chain as a connected vertical flow.
 *
 * The old flat list showed each hop as a separate row, which read as an
 * unordered set rather than a path — the whole point of a "ripple" is that the
 * links are directional and ordered. This draws the connective tissue, marks
 * the terminal node as the tradable ticker, and grades node emphasis by depth.
 *
 * Zero backend cost: everything here already ships in the egg payload.
 */
export function RipplePathViz({ path, ticker }: { path: RipplePath; ticker?: string }) {
  if (!path.length) return null;

  return (
    <ol className="relative flex flex-col" data-testid="ripple-path-viz">
      {path.map((step, i) => {
        const isLast = i === path.length - 1;
        const isFirst = i === 0;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Connector rail */}
            <div className="flex flex-col items-center">
              <div
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tabular",
                  isFirst
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : isLast
                      ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {i + 1}
              </div>
              {!isLast && <div className="mt-1 w-px flex-1 bg-gradient-to-b from-border to-border/30" />}
            </div>

            {/* Node */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={["text-sm", isLast ? "font-medium text-foreground" : "text-foreground/85"].join(
                    " "
                  )}
                >
                  {step.node}
                </span>
                {isFirst && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                    catalyst
                  </span>
                )}
                {isLast && ticker && (
                  <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-emerald-400">
                    {ticker}
                  </span>
                )}
              </div>
              {step.relation && !isLast && (
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  ↓ {step.relation.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
