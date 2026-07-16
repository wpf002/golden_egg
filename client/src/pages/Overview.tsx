import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Play, TrendingUp, Zap, Database } from "lucide-react";
import { useState } from "react";
import type { Catalyst, GoldenEggWithCatalyst, ScanRun } from "@/lib/types";
import { EggCard } from "@/components/EggCard";
import { EggDetailSheet } from "@/components/EggDetailSheet";
import { formatRelative } from "@/components/AppShell";
import { Link, useLocation } from "wouter";
import { LoadingSkeleton, ErrorState, EmptyState } from "@/components/QueryState";
import { SectorHeatmap } from "@/components/SectorHeatmap";

export default function Overview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openEggId, setOpenEggId] = useState<number | null>(null);
  const [, setLocation] = useLocation();

  const eggsQ = useQuery<GoldenEggWithCatalyst[]>({ queryKey: ["/api/eggs"] });
  const catalystsQ = useQuery<Catalyst[]>({ queryKey: ["/api/catalysts"] });
  const scansQ = useQuery<ScanRun[]>({ queryKey: ["/api/scans"] });

  const eggs = eggsQ.data ?? [];
  const catalysts = catalystsQ.data ?? [];
  const scans = scansQ.data ?? [];

  const isLoading = eggsQ.isLoading || catalystsQ.isLoading || scansQ.isLoading;
  const error = eggsQ.error ?? catalystsQ.error ?? scansQ.error;

  const scanMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/scan/run"),
    onSuccess: async (_r) => {
      const data = await _r.json();
      toast({
        title: "Scan complete",
        description:
          `${data.eggsCreated} new eggs, ${data.cacheHits} cache hits, ~${data.approxCredits} credits` +
          (data.budgetExhausted ? " — credit ceiling hit; remaining themes deferred" : ""),
      });
      qc.invalidateQueries();
    },
    onError: (e: Error) =>
      toast({
        title: "Scan failed",
        // A 409 means a scan is already running — surface that plainly.
        description: e.message.includes("409") ? "A scan is already running." : e.message,
        variant: "destructive",
      }),
  });

  const topEggs = [...eggs]
    .sort((a, b) => b.confidence * (1 + b.noveltyScore) - a.confidence * (1 + a.noveltyScore))
    .slice(0, 6);
  const totalCredits = scans.reduce((s, r) => s + r.approxCredits, 0);
  const totalCacheHits = scans.reduce((s, r) => s + r.cacheHits, 0);

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      {/* Hero row */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h2 className="font-display text-2xl font-medium tracking-tight text-foreground mb-2">
            What ripples are worth trading right now?
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
            Golden Egg watches emerging catalysts and traces them 2–3 hops out to find the non-obvious picks
            and shovels. Everything you see is a public-market ticker.
          </p>
        </div>
        <Button
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          data-testid="button-run-scan"
        >
          <Play size={14} className="mr-2" />
          {scanMut.isPending ? "Scanning…" : "Run scan now"}
        </Button>
      </div>

      {error && (
        <ErrorState
          error={error}
          label="Couldn't load the dashboard"
          onRetry={() => {
            eggsQ.refetch();
            catalystsQ.refetch();
            scansQ.refetch();
          }}
        />
      )}

      {!error && isLoading && <LoadingSkeleton rows={4} />}

      {!error && !isLoading && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-4 mb-10">
            <StatCard
              label="Golden Eggs"
              value={eggs.length}
              icon={Zap}
              sublabel={`${eggs.filter((e) => e.confidence >= 0.75).length} high-conf`}
            />
            <StatCard
              label="Catalysts tracked"
              value={catalysts.length}
              icon={TrendingUp}
              sublabel={`${catalysts.filter((c) => !c.rippleAnalyzed).length} unanalyzed`}
            />
            <StatCard
              label="Cache hits"
              value={totalCacheHits}
              icon={Database}
              sublabel="free reruns"
              accent="pos"
            />
            <StatCard
              label="Credits used"
              value={totalCredits}
              icon={Zap}
              sublabel={`across ${scans.length} scans`}
            />
          </div>

          {/* Sector heatmap */}
          {eggs.length > 0 && (
            <section className="mb-10">
              <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-sm uppercase tracking-widest text-muted-foreground">
                  Where the conviction sits
                </h3>
                <span className="text-xs text-muted-foreground/70">
                  size = egg count · shade = avg confidence
                </span>
              </div>
              <SectorHeatmap
                eggs={eggs}
                onSelectSector={(s) => setLocation(`/eggs?sector=${encodeURIComponent(s)}`)}
              />
            </section>
          )}

          {/* Top eggs */}
          <section className="mb-10">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Top parallel plays</h3>
              <Link href="/eggs" className="text-xs text-primary hover:underline">
                View all →
              </Link>
            </div>
            {topEggs.length === 0 ? (
              <EmptyState message="Run your first scan to see parallel-market opportunities." />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {topEggs.map((egg) => (
                  <EggCard key={egg.id} egg={egg} onOpen={setOpenEggId} />
                ))}
              </div>
            )}
          </section>

          {/* Recent catalysts */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Recent catalysts</h3>
              <Link href="/catalysts" className="text-xs text-primary hover:underline">
                View all →
              </Link>
            </div>
            <div className="border border-card-border bg-card rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Catalyst</th>
                    <th className="text-left px-4 py-2.5 font-medium">Theme</th>
                    <th className="text-left px-4 py-2.5 font-medium">Source</th>
                    <th className="text-right px-4 py-2.5 font-medium">Strength</th>
                    <th className="text-right px-4 py-2.5 font-medium">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {catalysts.slice(0, 10).map((c) => (
                    <tr key={c.id} className="border-b border-border/40 hover-elevate">
                      <td
                        className="px-4 py-3 max-w-md truncate text-foreground"
                        data-testid={`text-catalyst-${c.id}`}
                      >
                        {c.title}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground italic">{c.theme}</td>
                      <td className="px-4 py-3 text-muted-foreground uppercase text-[10px] tracking-wider">
                        {c.sourceType.replace("_", " ")}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-primary font-mono">
                        {(c.strengthScore * 100).toFixed(0)}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-muted-foreground text-xs">
                        {formatRelative(c.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
                  {catalysts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        No catalysts yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <EggDetailSheet eggId={openEggId} onClose={() => setOpenEggId(null)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  sublabel,
  accent,
}: {
  label: string;
  value: number | string;
  icon: any;
  sublabel?: string;
  accent?: "pos" | "neg";
}) {
  return (
    <div className="border border-card-border bg-card rounded-md p-4">
      <div className="flex items-center justify-between mb-2 text-muted-foreground">
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className={`text-2xl font-display tabular ${accent === "pos" ? "text-pos" : "text-foreground"}`}>
        {value}
      </div>
      {sublabel && <div className="text-[11px] text-muted-foreground mt-1 tabular">{sublabel}</div>}
    </div>
  );
}
