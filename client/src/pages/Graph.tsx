import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef, useEffect } from "react";
import type { GraphNode, GraphEdge } from "@/lib/types";
import { Input } from "@/components/ui/input";

/**
 * A lightweight interactive graph view — no D3, just SVG + a simple
 * force-free radial layout centered on the selected node.
 * Click a node to focus its supply-chain ripple network.
 */
export default function GraphPage() {
  const { data } = useQuery<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ queryKey: ["/api/graph"] });
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<string | null>(null);

  const focusNode = focus ? nodes.find((n) => n.slug === focus) : null;
  const industries = nodes.filter((n) => n.kind === "industry");

  const layout = useMemo(() => {
    if (!focusNode) return { nodes: [], edges: [] };
    // Find 1-hop and 2-hop neighbors
    const level1: GraphNode[] = [];
    const level2: GraphNode[] = [];
    const seen = new Set<number>([focusNode.id]);

    const outEdges = edges.filter((e) => e.fromNodeId === focusNode.id);
    for (const e of outEdges) {
      const n = nodes.find((n) => n.id === e.toNodeId);
      if (n && !seen.has(n.id)) { level1.push(n); seen.add(n.id); }
    }
    for (const n1 of level1) {
      const outs = edges.filter((e) => e.fromNodeId === n1.id);
      for (const e of outs) {
        const n = nodes.find((nn) => nn.id === e.toNodeId);
        if (n && !seen.has(n.id)) { level2.push(n); seen.add(n.id); }
      }
    }

    const cx = 450, cy = 300;
    const positioned = new Map<number, { x: number; y: number; node: GraphNode; ring: 0 | 1 | 2 }>();
    positioned.set(focusNode.id, { x: cx, y: cy, node: focusNode, ring: 0 });
    level1.forEach((n, i) => {
      const angle = (i / level1.length) * Math.PI * 2 - Math.PI / 2;
      positioned.set(n.id, { x: cx + Math.cos(angle) * 160, y: cy + Math.sin(angle) * 130, node: n, ring: 1 });
    });
    level2.forEach((n, i) => {
      const angle = (i / level2.length) * Math.PI * 2 - Math.PI / 4;
      positioned.set(n.id, { x: cx + Math.cos(angle) * 300, y: cy + Math.sin(angle) * 260, node: n, ring: 2 });
    });

    const includedIds = new Set(positioned.keys());
    const visibleEdges = edges.filter((e) => includedIds.has(e.fromNodeId) && includedIds.has(e.toNodeId));
    return { nodes: Array.from(positioned.values()), edges: visibleEdges, positioned };
  }, [focusNode, nodes, edges]);

  const filteredNodes = search
    ? nodes.filter((n) => n.name.toLowerCase().includes(search.toLowerCase()) || (n.ticker ?? "").toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Left rail: pick a catalyst root */}
        <aside className="border border-card-border bg-card rounded-md p-4 max-h-[70vh] overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Catalyst roots</div>
          <div className="flex flex-col gap-1">
            {industries.map((n) => (
              <button
                key={n.id}
                onClick={() => setFocus(n.slug)}
                className={`text-left px-2.5 py-1.5 rounded text-sm ${focus === n.slug ? "bg-primary/15 text-primary" : "text-foreground/85 hover:bg-secondary"}`}
                data-testid={`button-focus-${n.slug}`}
              >
                {n.name}
              </button>
            ))}
          </div>
          <div className="mt-6 mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">Search all nodes</div>
          <Input placeholder="Ticker or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <div className="flex flex-col gap-0.5">
            {filteredNodes.slice(0, 20).map((n) => (
              <button
                key={n.id}
                onClick={() => setFocus(n.slug)}
                className="text-left px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                {n.name} {n.ticker && <span className="font-mono text-primary/80">({n.ticker})</span>}
              </button>
            ))}
          </div>
        </aside>

        {/* Graph canvas */}
        <div className="border border-card-border bg-card rounded-md overflow-hidden relative min-h-[70vh]">
          {!focusNode ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground text-center px-8">
              Pick a catalyst root on the left to trace its supply-chain ripples.
            </div>
          ) : (
            <svg viewBox="0 0 900 600" className="w-full h-full">
              {/* Edges */}
              {layout.edges.map((e) => {
                const from = (layout.positioned as any)?.get(e.fromNodeId);
                const to = (layout.positioned as any)?.get(e.toNodeId);
                if (!from || !to) return null;
                const stroke = e.strength < 0 ? "hsl(var(--neg))" : "hsl(var(--muted-foreground))";
                const opacity = 0.3 + Math.abs(e.strength) * 0.5;
                return (
                  <line
                    key={e.id}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={stroke}
                    strokeWidth={0.5 + Math.abs(e.strength) * 1.5}
                    opacity={opacity}
                  />
                );
              })}
              {/* Nodes */}
              {layout.nodes.map(({ node, x, y, ring }) => {
                const r = ring === 0 ? 20 : ring === 1 ? 12 : 8;
                const isPrimary = ring === 0;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${x} ${y})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setFocus(node.slug)}
                  >
                    <circle
                      r={r}
                      fill={isPrimary ? "hsl(var(--primary))" : "hsl(var(--card))"}
                      stroke={isPrimary ? "hsl(var(--primary))" : "hsl(var(--border))"}
                      strokeWidth={1.5}
                    />
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      className="fill-foreground"
                      fontSize={ring === 0 ? 12 : 10}
                      style={{ pointerEvents: "none" }}
                    >
                      {node.name.length > 22 ? node.name.slice(0, 20) + "…" : node.name}
                    </text>
                    {node.ticker && (
                      <text
                        y={r + 24}
                        textAnchor="middle"
                        className="fill-primary/80"
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        style={{ pointerEvents: "none" }}
                      >
                        {node.ticker}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground text-center">
        {nodes.length} nodes · {edges.length} edges. Click any node to re-center the ripple.
      </div>
    </div>
  );
}
