import { useMemo } from "react";
import type { GoldenEggWithCatalyst } from "@/lib/types";

/**
 * Where is the conviction concentrated?
 *
 * Cells are sized by egg count and shaded by mean confidence, so a dense,
 * high-confidence sector reads loudest. Derived entirely from eggs already in
 * the query cache — no new backend call, no credits.
 */

type Cell = {
  sector: string;
  count: number;
  avgConfidence: number;
  avgNovelty: number;
  topTicker: string | null;
};

function buildCells(eggs: GoldenEggWithCatalyst[]): Cell[] {
  const bySector = new Map<string, GoldenEggWithCatalyst[]>();
  for (const e of eggs) {
    const s = e.sector?.trim() || "Unclassified";
    if (!bySector.has(s)) bySector.set(s, []);
    bySector.get(s)!.push(e);
  }

  return Array.from(bySector.entries())
    .map(([sector, list]) => {
      const avg = (f: (e: GoldenEggWithCatalyst) => number) =>
        list.reduce((sum, e) => sum + f(e), 0) / list.length;
      const top = [...list].sort((a, b) => b.confidence - a.confidence)[0];
      return {
        sector,
        count: list.length,
        avgConfidence: avg((e) => e.confidence),
        avgNovelty: avg((e) => e.noveltyScore ?? 0.5),
        topTicker: top?.ticker ?? null,
      };
    })
    .sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence);
}

/**
 * Map confidence to a gold tint, normalized across the range actually present.
 *
 * A raw confidence→alpha mapping is useless here: the model's confidences all
 * cluster in ~0.70–0.83, so every cell came out the same shade and the heatmap
 * conveyed nothing. Stretching the observed min..max across the alpha range
 * makes the differences legible. Degenerate case (all equal) → mid tint.
 */
function makeTint(min: number, max: number) {
  const span = max - min;
  return (confidence: number) => {
    const t = span < 0.01 ? 0.5 : (confidence - min) / span;
    const alpha = 0.1 + t * 0.45; // 0.10 .. 0.55
    return `hsl(var(--primary) / ${alpha.toFixed(2)})`;
  };
}

export function SectorHeatmap({
  eggs,
  onSelectSector,
}: {
  eggs: GoldenEggWithCatalyst[];
  onSelectSector?: (sector: string) => void;
}) {
  const cells = useMemo(() => buildCells(eggs), [eggs]);
  const maxCount = cells[0]?.count ?? 1;
  const tint = useMemo(() => {
    const confs = cells.map((c) => c.avgConfidence);
    return makeTint(Math.min(...confs), Math.max(...confs));
  }, [cells]);

  if (!cells.length) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="sector-heatmap">
      {cells.map((c) => {
        // Weight width by count so the eye lands on concentration first.
        const scale = Math.sqrt(c.count / maxCount);
        const basis = 110 + scale * 130;
        return (
          <button
            key={c.sector}
            onClick={() => onSelectSector?.(c.sector)}
            style={{ background: tint(c.avgConfidence), flexBasis: `${basis}px` }}
            className="group relative flex-grow rounded-md border border-card-border p-3 text-left transition-colors hover:border-primary/50"
            data-testid={`heatmap-cell-${c.sector.toLowerCase().replace(/\s+/g, "-")}`}
            title={`${c.sector} · ${c.count} eggs · ${(c.avgConfidence * 100).toFixed(0)}% avg confidence · ${(c.avgNovelty * 100).toFixed(0)}% avg novelty`}
          >
            <div className="truncate text-xs font-medium text-foreground">{c.sector}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-lg tabular leading-none text-foreground">{c.count}</span>
              <span className="font-mono text-[10px] uppercase tabular text-muted-foreground">
                {(c.avgConfidence * 100).toFixed(0)}% Conf
              </span>
            </div>
            {c.topTicker && (
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Top {c.topTicker}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { buildCells as __buildCells };
