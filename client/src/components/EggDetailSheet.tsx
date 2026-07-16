import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GoldenEggDetail, RipplePath } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatRelative } from "@/components/AppShell";
import { ConfidenceBar } from "@/components/EggCard";
import { Button } from "@/components/ui/button";
import { ArrowRight, ExternalLink, Star, Clock, TrendingUp, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function EggDetailSheet({ eggId, onClose }: { eggId: number | null; onClose: () => void }) {
  const open = eggId != null;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: egg, isLoading } = useQuery<GoldenEggDetail>({
    queryKey: ["/api/eggs", eggId],
    enabled: open,
  });

  const addMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/watchlist", { eggId: eggId!, addedAt: Date.now() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/eggs", eggId] });
      qc.invalidateQueries({ queryKey: ["/api/eggs"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: `Tracking ${egg?.ticker}`, description: egg?.companyName });
    },
  });
  const removeMut = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/watchlist/${eggId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/eggs", eggId] });
      qc.invalidateQueries({ queryKey: ["/api/eggs"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });
  const refreshPricesMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/prices/refresh"),
    onSuccess: async (res) => {
      const j = await res.json();
      toast({ title: "Prices refreshed", description: `${j.refreshed}/${j.tickers} tickers updated` });
      qc.invalidateQueries({ queryKey: ["/api/eggs", eggId] });
      qc.invalidateQueries({ queryKey: ["/api/eggs"] });
    },
  });

  let path: RipplePath = [];
  try {
    if (egg?.ripplePath) path = JSON.parse(egg.ripplePath);
  } catch {}

  const hasPrices = egg?.priceAtFlag != null && egg?.currentPrice != null && egg.priceAtFlag > 0;
  const deltaPct = hasPrices ? ((egg!.currentPrice! - egg!.priceAtFlag!) / egg!.priceAtFlag!) * 100 : null;
  const deltaColor =
    deltaPct == null
      ? "text-muted-foreground"
      : deltaPct > 0
        ? "text-emerald-400"
        : deltaPct < 0
          ? "text-rose-400"
          : "text-muted-foreground";

  const hopLabel =
    egg?.hopDistance === 1
      ? "1st-order"
      : egg?.hopDistance === 2
        ? "2nd-order"
        : egg?.hopDistance === 3
          ? "3rd-order"
          : `hop ${egg?.hopDistance}`;

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
        data-testid="sheet-egg-detail"
      >
        {isLoading || !egg ? (
          <div className="pt-8 space-y-4">
            <div className="h-6 w-32 bg-secondary rounded animate-pulse" />
            <div className="h-4 w-48 bg-secondary rounded animate-pulse" />
            <div className="h-24 w-full bg-secondary rounded animate-pulse" />
          </div>
        ) : (
          <>
            <SheetHeader className="text-left mb-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <SheetTitle
                    className="font-mono text-xl text-primary tracking-tight tabular"
                    data-testid="text-detail-ticker"
                  >
                    {egg.ticker}
                  </SheetTitle>
                  <span className="text-sm text-foreground truncate">{egg.companyName}</span>
                </div>
                <button
                  onClick={() => (egg.onWatchlist ? removeMut.mutate() : addMut.mutate())}
                  className={`p-1.5 rounded-md transition-colors ${
                    egg.onWatchlist
                      ? "text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                  }`}
                  aria-label={egg.onWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                  data-testid={`button-detail-watch-${egg.id}`}
                >
                  <Star size={18} fill={egg.onWatchlist ? "currentColor" : "none"} strokeWidth={1.75} />
                </button>
              </div>
            </SheetHeader>

            {/* Meta badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-6 text-[10px] uppercase tracking-wider">
              <span className="bg-primary-subtle px-1.5 py-0.5 rounded font-medium">{hopLabel}</span>
              {egg.sector && (
                <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                  {egg.sector}
                </span>
              )}
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Clock size={10} /> {egg.timingLag}
              </span>
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <TrendingUp size={10} /> novelty {(egg.noveltyScore * 100).toFixed(0)}
              </span>
              <span className="ml-auto text-muted-foreground">Flagged {formatRelative(egg.createdAt)}</span>
            </div>

            {/* Prices */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <PriceCell label="At flag" value={egg.priceAtFlag} />
              <PriceCell label="Current" value={egg.currentPrice} />
              <div className="border border-card-border rounded-md p-3 bg-card">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Return</div>
                <div className={`font-mono text-lg tabular ${deltaColor}`} data-testid="text-detail-return">
                  {deltaPct == null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
                </div>
              </div>
            </div>

            {/* Refresh + last update */}
            <div className="flex items-center justify-between mb-6 text-[11px] text-muted-foreground tabular">
              <span>
                {egg.priceRefreshedAt
                  ? `Prices ${formatRelative(egg.priceRefreshedAt)}`
                  : "Prices not yet fetched"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refreshPricesMut.mutate()}
                disabled={refreshPricesMut.isPending}
                data-testid="button-refresh-prices"
                className="h-7 text-[11px]"
              >
                <RefreshCw size={12} className={refreshPricesMut.isPending ? "animate-spin" : ""} />
                Refresh
              </Button>
            </div>

            {/* Thesis */}
            <Section label="Thesis">
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{egg.thesis}</p>
            </Section>

            {/* Confidence */}
            <Section label="Confidence">
              <ConfidenceBar value={egg.confidence} />
            </Section>

            {/* Ripple path */}
            {path.length > 0 && (
              <Section label="Ripple path">
                <div className="flex flex-col gap-1.5">
                  {path.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-[10px] text-muted-foreground/60 w-4 tabular">
                        {i + 1}
                      </span>
                      <span className="text-foreground">{p.node}</span>
                      {p.relation && (
                        <>
                          <ArrowRight size={12} className="text-muted-foreground/50" />
                          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            {p.relation}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Catalyst */}
            {egg.catalyst && (
              <Section label="Source catalyst">
                <div className="border border-card-border bg-card rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1.5 text-[10px] uppercase tracking-widest">
                    <span className="text-primary font-medium">{egg.catalyst.theme}</span>
                    <span className="text-muted-foreground/70">
                      {egg.catalyst.sourceType?.replace("_", " ")}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      Seen {formatRelative(egg.catalyst.lastSeenAt)}
                    </span>
                  </div>
                  <div className="text-sm text-foreground font-medium leading-snug mb-1.5">
                    {egg.catalyst.title}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{egg.catalyst.summary}</p>
                  {egg.catalyst.sourceUrl && (
                    <a
                      href={egg.catalyst.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      data-testid="link-catalyst-source"
                    >
                      Open source <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </Section>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PriceCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="border border-card-border rounded-md p-3 bg-card">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="font-mono text-lg text-foreground tabular">
        {value == null ? "—" : `$${value.toFixed(2)}`}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}
