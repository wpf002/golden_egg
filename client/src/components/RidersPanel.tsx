import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Play, TrendingUp } from "lucide-react";
import { LoadingSkeleton, EmptyState } from "@/components/QueryState";
import { Pagination } from "@/components/Pagination";

type Rider = {
  id: number;
  riderTicker: string;
  riderName: string;
  anchorTicker: string;
  anchorName: string;
  thesis: string;
  linkage: string;
  verdict: "cheaper-for-the-growth" | "richer-for-the-growth" | "comparable" | "unknown";
  riderRatio: number | null;
  anchorRatio: number | null;
  premiumPct: number | null;
  sizeRatio: number | null;
  riderMarketCapM: number | null;
  riderGrowthPct: number | null;
  riderPriceToSales: number | null;
  noveltyScore: number;
};

const VERDICT_COPY: Record<Rider["verdict"], { label: string; cls: string }> = {
  "cheaper-for-the-growth": { label: "Better Value", cls: "bg-emerald-400/10 text-emerald-400" },
  "richer-for-the-growth": { label: "Expensive", cls: "bg-rose-400/10 text-rose-400" },
  comparable: { label: "About The Same", cls: "bg-secondary text-secondary-foreground" },
  unknown: { label: "No Figures Yet", cls: "bg-secondary text-muted-foreground" },
};

function money(m: number | null) {
  if (m == null) return "—";
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(1)}T`;
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  return `$${m.toFixed(0)}M`;
}

const PAGE_SIZE = 8;

export function RidersPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [anchor, setAnchor] = useState("");
  const [page, setPage] = useState(1);

  const picksQ = useQuery<Rider[]>({ queryKey: ["/api/coattails"] });
  const anchorsQ = useQuery<{ suggested: string[] }>({ queryKey: ["/api/coattails/anchors"] });
  const picks = picksQ.data ?? [];

  const scanMut = useMutation({
    mutationFn: async (t: string) => apiRequest("POST", "/api/coattails/scan", { anchor: t }),
    onSuccess: async (r) => {
      const j = await r.json();
      toast({
        title: `Scanned ${j.anchor}`,
        description: `${j.saved} riders priced${j.skipped ? ` · ${j.skipped} skipped` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/coattails"] });
      setAnchor("");
    },
    onError: (e: Error) => toast({ title: "Scan Failed", description: e.message, variant: "destructive" }),
  });

  const totalPages = Math.max(1, Math.ceil(picks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = picks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed mb-4">
          Type in a big company everyone already follows. You&rsquo;ll get back the smaller companies that
          grow when it grows, and whether each one looks cheap or expensive next to it. A company at 25x sales
          growing 150% is better value than one at 18x growing 85% &mdash; the kind of thing a plain price tag
          hides.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Big company, e.g. NVDA"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && anchor && scanMut.mutate(anchor)}
            className="max-w-[220px] font-mono"
            data-testid="input-big-company"
          />
          <Button
            onClick={() => anchor && scanMut.mutate(anchor)}
            disabled={!anchor || scanMut.isPending}
            data-testid="button-find-riders"
          >
            <Play size={14} className={scanMut.isPending ? "animate-pulse mr-2" : "mr-2"} />
            {scanMut.isPending ? "Scanning…" : "Run the Scan Now"}
          </Button>
          {(anchorsQ.data?.suggested ?? []).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              <span className="uppercase tracking-wider text-[10px]">Try:</span>
              {anchorsQ.data!.suggested.map((t) => (
                <button
                  key={t}
                  onClick={() => scanMut.mutate(t)}
                  disabled={scanMut.isPending}
                  className="font-mono text-primary hover:underline disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {picksQ.isLoading && <LoadingSkeleton rows={3} />}

      {!picksQ.isLoading && picks.length === 0 && (
        <EmptyState
          message="Nothing here yet."
          hint="Put a big company in the box above and we'll show you who grows alongside it."
        />
      )}

      <div className="flex flex-col gap-3">
        {visible.map((p) => {
          const v = VERDICT_COPY[p.verdict];
          return (
            <div
              key={p.id}
              className="border border-card-border bg-card rounded-md p-4"
              data-testid={`card-rider-${p.id}`}
            >
              <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap mb-1">
                    <span className="font-mono text-lg text-primary tabular">{p.riderTicker}</span>
                    <span className="text-sm text-foreground">{p.riderName}</span>
                    <span className="text-xs text-muted-foreground">
                      grows with <span className="font-mono text-foreground/80">{p.anchorTicker}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${v.cls}`}>{v.label}</span>
                    {p.sizeRatio && p.sizeRatio >= 2 && (
                      <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                        {Math.round(p.sizeRatio)}× Smaller
                      </span>
                    )}
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <TrendingUp size={10} /> Novelty {(p.noveltyScore * 100).toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-foreground/80 leading-relaxed mb-3">{p.thesis}</p>
              <div className="text-[11px] text-muted-foreground mb-3">
                <span className="uppercase tracking-wider">Why: </span>
                {p.linkage}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-border/50 text-xs">
                <Metric label="Market cap" value={money(p.riderMarketCapM)} />
                <Metric
                  label="Revenue growth"
                  value={p.riderGrowthPct == null ? "—" : `${p.riderGrowthPct.toFixed(0)}%`}
                />
                <Metric
                  label="Price / sales"
                  value={p.riderPriceToSales == null ? "—" : `${p.riderPriceToSales.toFixed(1)}×`}
                />
                <Metric
                  label={`vs ${p.anchorTicker}`}
                  value={
                    p.premiumPct == null ? "—" : `${p.premiumPct > 0 ? "+" : ""}${p.premiumPct.toFixed(0)}%`
                  }
                  accent={p.premiumPct == null ? undefined : p.premiumPct < 0 ? "pos" : "neg"}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</div>
      <div
        className={`font-mono tabular ${accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-rose-400" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
