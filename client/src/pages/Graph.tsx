import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { GraphNode, GraphEdge } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton, ErrorState } from "@/components/QueryState";
import { titleCase } from "@/lib/text";
import { ArrowLeft, RotateCcw, X, Crosshair } from "lucide-react";

/**
 * The supply-chain map. Hand-rolled SVG — no charting library.
 *
 * Interaction model, deliberately:
 *  - Clicking a node SELECTS it and opens a detail panel. It does not yank the
 *    whole view somewhere else — that was disorienting and showed nothing.
 *  - "Center Here" in the panel re-centers the map on that node, and Back /
 *    Reset View always get you home.
 *  - Second-ring nodes cluster around their parent instead of being sprayed
 *    evenly around the circle, so supply chains read as chains.
 */
export default function GraphPage() {
  const graphQ = useQuery<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ queryKey: ["/api/graph"] });
  const nodes = graphQ.data?.nodes ?? [];
  const edges = graphQ.data?.edges ?? [];

  const [search, setSearch] = useState("");
  const [rootSlug, setRootSlug] = useState<string | null>(null);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const industries = nodes.filter((n) => n.kind === "industry");
  const effectiveRoot = rootSlug ?? industries[0]?.slug ?? null;
  const effectiveFocus = focusSlug ?? effectiveRoot;
  const focusNode = effectiveFocus ? nodes.find((n) => n.slug === effectiveFocus) : null;
  const selectedNode = selectedId != null ? (nodes.find((n) => n.id === selectedId) ?? null) : null;

  const pickRoot = (slug: string) => {
    setRootSlug(slug);
    setFocusSlug(null);
    setHistory([]);
    setSelectedId(null);
  };
  const centerOn = (slug: string) => {
    if (slug === effectiveFocus) return;
    if (effectiveFocus) setHistory((h) => [...h, effectiveFocus]);
    setFocusSlug(slug);
  };
  const goBack = () => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      setFocusSlug(prev ?? null);
      return h.slice(0, -1);
    });
  };
  const resetView = () => {
    setFocusSlug(null);
    setHistory([]);
    setSelectedId(null);
  };

  const layout = useMemo(() => {
    if (!focusNode) return null;
    const CX = 500;
    const CY = 300;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Ring 1: direct connections out of the focus node.
    const level1: GraphNode[] = [];
    const seen = new Set<number>([focusNode.id]);
    for (const e of edges) {
      if (e.fromNodeId !== focusNode.id) continue;
      const n = byId.get(e.toNodeId);
      if (n && !seen.has(n.id)) {
        level1.push(n);
        seen.add(n.id);
      }
    }

    // Ring 2: children grouped under their ring-1 parent, so they land NEAR it.
    const childrenOf = new Map<number, GraphNode[]>();
    for (const p of level1) {
      for (const e of edges) {
        if (e.fromNodeId !== p.id) continue;
        const n = byId.get(e.toNodeId);
        if (n && !seen.has(n.id)) {
          seen.add(n.id);
          let kids = childrenOf.get(p.id);
          if (!kids) {
            kids = [];
            childrenOf.set(p.id, kids);
          }
          kids.push(n);
        }
      }
    }

    type Placed = { node: GraphNode; x: number; y: number; ring: 0 | 1 | 2 };
    const placed = new Map<number, Placed>();
    placed.set(focusNode.id, { node: focusNode, x: CX, y: CY, ring: 0 });

    const angleOf = new Map<number, number>();
    level1.forEach((n, i) => {
      const angle = (i / Math.max(1, level1.length)) * Math.PI * 2 - Math.PI / 2;
      angleOf.set(n.id, angle);
      placed.set(n.id, {
        node: n,
        x: CX + Math.cos(angle) * 190,
        y: CY + Math.sin(angle) * 148,
        ring: 1,
      });
    });
    for (const [parentId, kids] of childrenOf) {
      const base = angleOf.get(parentId) ?? 0;
      const spread = Math.min(0.42, 1.1 / Math.max(1, kids.length));
      kids.forEach((n, j) => {
        const angle = base + (j - (kids.length - 1) / 2) * spread;
        placed.set(n.id, {
          node: n,
          x: CX + Math.cos(angle) * 335,
          y: CY + Math.sin(angle) * 258,
          ring: 2,
        });
      });
    }

    const ids = new Set(placed.keys());
    const visibleEdges = edges.filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId));
    return { placed, visibleEdges, cx: CX, cy: CY };
  }, [focusNode, nodes, edges]);

  const filteredNodes = search
    ? nodes.filter(
        (n) =>
          n.name.toLowerCase().includes(search.toLowerCase()) ||
          (n.ticker ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : [];

  // Connections for the detail panel — both directions, so "who supplies this"
  // and "who this supplies" are both visible.
  const connections = useMemo(() => {
    if (!selectedNode) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: Array<{ node: GraphNode; label: string }> = [];
    for (const e of edges) {
      if (e.fromNodeId === selectedNode.id) {
        const n = byId.get(e.toNodeId);
        if (n) out.push({ node: n, label: e.relation.replace(/_/g, " ") });
      } else if (e.toNodeId === selectedNode.id) {
        const n = byId.get(e.fromNodeId);
        if (n) out.push({ node: n, label: `${e.relation.replace(/_/g, " ")} ←` });
      }
    }
    return out;
  }, [selectedNode, nodes, edges]);

  if (graphQ.error) {
    return (
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <ErrorState error={graphQ.error} label="Couldn't load the graph" onRetry={() => graphQ.refetch()} />
      </div>
    );
  }
  if (graphQ.isLoading) {
    return (
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="grid grid-cols-[270px_1fr] gap-6">
        {/* Left rail */}
        <aside
          className="border border-card-border bg-card rounded-md p-4 max-h-[74vh] overflow-y-auto"
          style={{ overscrollBehavior: "contain" }}
        >
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Catalysts</div>
          <div className="flex flex-col gap-1">
            {industries.map((n) => (
              <button
                key={n.id}
                onClick={() => pickRoot(n.slug)}
                className={`text-left px-2.5 py-1.5 rounded text-sm ${effectiveRoot === n.slug ? "bg-primary/15 text-primary" : "text-foreground/85 hover:bg-secondary"}`}
                data-testid={`button-focus-${n.slug}`}
              >
                {titleCase(n.name)}
              </button>
            ))}
          </div>
          <div className="mt-6 mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            Search the Map
          </div>
          <Input
            placeholder="Ticker or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2"
          />
          <div className="flex flex-col gap-0.5">
            {filteredNodes.slice(0, 20).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  centerOn(n.slug);
                  setSelectedId(n.id);
                  setSearch("");
                }}
                className="text-left px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                {titleCase(n.name)}{" "}
                {n.ticker && <span className="font-mono text-primary/80">({n.ticker})</span>}
              </button>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div className="relative border border-card-border bg-card rounded-md overflow-hidden min-h-[74vh]">
          {/* View controls */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            {history.length > 0 && (
              <Button variant="outline" size="sm" onClick={goBack} data-testid="button-graph-back">
                <ArrowLeft size={13} className="mr-1" />
                Back
              </Button>
            )}
            {(history.length > 0 || focusSlug) && (
              <Button variant="outline" size="sm" onClick={resetView} data-testid="button-graph-reset">
                <RotateCcw size={13} className="mr-1" />
                Reset View
              </Button>
            )}
          </div>

          {!focusNode || !layout ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground text-center px-8">
              Pick a catalyst on the left to see how it ripples through the supply chain.
            </div>
          ) : (
            <svg viewBox="0 0 1000 620" className="w-full h-full">
              {/* Ring guides */}
              <ellipse
                cx={layout.cx}
                cy={layout.cy}
                rx={190}
                ry={148}
                fill="none"
                stroke="hsl(var(--border))"
                strokeDasharray="2 6"
                opacity={0.35}
              />
              <ellipse
                cx={layout.cx}
                cy={layout.cy}
                rx={335}
                ry={258}
                fill="none"
                stroke="hsl(var(--border))"
                strokeDasharray="2 6"
                opacity={0.2}
              />

              {/* Edges — gently curved so chains read as flows, not spokes */}
              {layout.visibleEdges.map((e) => {
                const from = layout.placed.get(e.fromNodeId);
                const to = layout.placed.get(e.toNodeId);
                if (!from || !to) return null;
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;
                // Bow each edge slightly away from the center of the canvas.
                const dx = mx - layout.cx;
                const dy = my - layout.cy;
                const len = Math.max(1, Math.hypot(dx, dy));
                const bow = 14;
                const cxq = mx + (dx / len) * bow;
                const cyq = my + (dy / len) * bow;
                return (
                  <path
                    key={e.id}
                    d={`M ${from.x} ${from.y} Q ${cxq} ${cyq} ${to.x} ${to.y}`}
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={0.6 + Math.abs(e.strength) * 1.4}
                    opacity={0.18 + Math.abs(e.strength) * 0.32}
                  >
                    <title>{`${titleCase(from.node.name)} — ${e.relation.replace(/_/g, " ")} → ${titleCase(to.node.name)}`}</title>
                  </path>
                );
              })}

              {/* Nodes */}
              {Array.from(layout.placed.values()).map(({ node, x, y, ring }) => {
                const isFocus = ring === 0;
                const isSelected = node.id === selectedId;
                const isCompany = !!node.ticker;
                const r = isFocus ? 22 : ring === 1 ? 9 : 6.5;
                const fill = isFocus
                  ? "hsl(var(--primary))"
                  : isCompany
                    ? "hsl(var(--pos) / 0.16)"
                    : "hsl(var(--card))";
                const stroke = isFocus
                  ? "hsl(var(--primary))"
                  : isSelected
                    ? "hsl(var(--primary))"
                    : isCompany
                      ? "hsl(var(--pos) / 0.8)"
                      : "hsl(var(--border))";
                const label = titleCase(node.name);
                return (
                  <g
                    key={node.id}
                    transform={`translate(${x} ${y})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedId(node.id)}
                    // Keyboard access: tab between nodes, Enter/Space to open the panel.
                    tabIndex={0}
                    role="button"
                    aria-label={`${label}${node.ticker ? ` (${node.ticker})` : ""} — press Enter for details`}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                    data-testid={`graph-node-${node.slug}`}
                  >
                    <title>{label}</title>
                    {isSelected && !isFocus && (
                      <circle
                        r={r + 4}
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        opacity={0.7}
                      />
                    )}
                    <circle r={r} fill={fill} stroke={stroke} strokeWidth={isFocus ? 2 : 1.5} />
                    <text
                      y={r + 13}
                      textAnchor="middle"
                      fontSize={isFocus ? 13 : ring === 1 ? 10.5 : 9.5}
                      style={{
                        pointerEvents: "none",
                        fill: "hsl(var(--foreground))",
                        paintOrder: "stroke",
                        stroke: "hsl(var(--card))",
                        strokeWidth: 3,
                      }}
                    >
                      {label.length > 24 ? label.slice(0, 22) + "…" : label}
                    </text>
                    {node.ticker && (
                      <text
                        y={r + 25}
                        textAnchor="middle"
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        style={{
                          pointerEvents: "none",
                          fill: "hsl(var(--primary) / 0.85)",
                          paintOrder: "stroke",
                          stroke: "hsl(var(--card))",
                          strokeWidth: 3,
                        }}
                      >
                        {node.ticker}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {/* Detail panel */}
          {selectedNode && (
            <div
              className="absolute right-3 top-3 z-10 w-72 rounded-md border border-card-border bg-background/95 backdrop-blur p-4 shadow-lg"
              data-testid="graph-node-panel"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground leading-snug">
                    {titleCase(selectedNode.name)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider">
                    <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                      {selectedNode.kind}
                    </span>
                    {selectedNode.ticker && (
                      <span className="font-mono text-primary">{selectedNode.ticker}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                  aria-label="Close panel"
                  data-testid="button-close-node-panel"
                >
                  <X size={14} />
                </button>
              </div>

              {selectedNode.description && (
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  {selectedNode.description}
                </p>
              )}

              {selectedNode.slug !== effectiveFocus && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mb-3 h-7 text-[11px]"
                  onClick={() => centerOn(selectedNode.slug)}
                  data-testid="button-center-node"
                >
                  <Crosshair size={12} className="mr-1" />
                  Center Here
                </Button>
              )}

              {connections.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    Connections ({connections.length})
                  </div>
                  <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5 -mx-1">
                    {connections.slice(0, 12).map((c, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedId(c.node.id);
                          centerOn(c.node.slug);
                        }}
                        className="flex items-baseline justify-between gap-2 px-1 py-1 rounded text-left hover:bg-secondary"
                      >
                        <span className="text-xs text-foreground/85 truncate">{titleCase(c.node.name)}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
                          {c.label}
                        </span>
                      </button>
                    ))}
                    {connections.length > 12 && (
                      <div className="px-1 py-1 text-[10px] text-muted-foreground">
                        +{connections.length - 12} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Legend */}
          {focusNode && (
            <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" /> Focus
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border border-pos inline-block" /> Public Company
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border border-border inline-block" /> Industry /
                Material
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground text-center">
        {nodes.length} nodes · {edges.length} edges · Click a node to see its details and connections.
      </div>
    </div>
  );
}
