import type { GoldenEggWithCatalyst, RipplePath } from "@/lib/types";
import { Star, TrendingUp, Clock, ArrowRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { returnVsFlag, deltaColor } from "@/lib/returns";

export function EggCard({ egg, onOpen }: { egg: GoldenEggWithCatalyst; onOpen?: (id: number) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const addMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/watchlist", { eggId: egg.id, addedAt: Date.now() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/eggs"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: `Tracking ${egg.ticker}`, description: egg.companyName });
    },
  });
  const removeMut = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/watchlist/${egg.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/eggs"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  let path: RipplePath = [];
  try {
    if (egg.ripplePath) path = JSON.parse(egg.ripplePath);
  } catch {}

  const hopBadge = egg.hopDistance === 1 ? "1st-order" : egg.hopDistance === 2 ? "2nd-order" : "3rd-order";

  // Price delta — suppressed when the flag price is corrupt (see lib/returns).
  const { pct: deltaPct, suspect: badFlagPrice } = returnVsFlag(egg.priceAtFlag, egg.currentPrice);
  const deltaClass = deltaColor(deltaPct);

  return (
    <div
      className="border border-card-border bg-card rounded-md hover-elevate p-5 group cursor-pointer"
      data-testid={`card-egg-${egg.id}`}
      onClick={() => onOpen?.(egg.id)}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(ev) => {
        if (onOpen && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          onOpen(egg.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-3 min-w-0 flex-1">
          <div
            className="font-mono text-lg font-medium text-primary tracking-tight tabular"
            data-testid={`text-ticker-${egg.id}`}
          >
            {egg.ticker}
          </div>
          <div className="text-sm text-foreground truncate flex-1">{egg.companyName}</div>
          {egg.currentPrice != null && (
            <div className="text-right shrink-0">
              <div className="font-mono text-sm text-foreground tabular" data-testid={`text-price-${egg.id}`}>
                ${egg.currentPrice.toFixed(2)}
              </div>
              {deltaPct != null && (
                <div className={`font-mono text-[10px] tabular ${deltaClass}`}>
                  {deltaPct >= 0 ? "+" : ""}
                  {deltaPct.toFixed(1)}%
                </div>
              )}
              {badFlagPrice && (
                <div
                  className="text-[10px] text-muted-foreground/70"
                  title="The recorded flag price looks corrupt, so return-vs-flag is unreliable for this egg."
                  data-testid={`text-bad-flag-${egg.id}`}
                >
                  flag price?
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            if (egg.onWatchlist) removeMut.mutate();
            else addMut.mutate();
          }}
          className={`flex-shrink-0 p-1.5 rounded-md transition-colors ${
            egg.onWatchlist
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:text-primary hover:bg-primary/5"
          }`}
          aria-label={egg.onWatchlist ? "Remove from watchlist" : "Add to watchlist"}
          data-testid={`button-watch-${egg.id}`}
        >
          <Star size={16} fill={egg.onWatchlist ? "currentColor" : "none"} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[10px] uppercase tracking-wider">
        <span className="bg-primary-subtle px-1.5 py-0.5 rounded font-medium">{hopBadge}</span>
        {egg.sector && (
          <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{egg.sector}</span>
        )}
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <Clock size={10} /> {egg.timingLag}
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp size={10} /> novelty {(egg.noveltyScore * 100).toFixed(0)}
        </span>
      </div>

      <p className="text-sm text-foreground/80 leading-relaxed mb-4">{egg.thesis}</p>

      {path.length > 0 && (
        <div className="text-[11px] text-muted-foreground mb-3 flex items-center flex-wrap gap-1">
          {path.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-foreground/70">{p.node}</span>
              {i < path.length - 1 && <ArrowRight size={10} className="text-muted-foreground/60" />}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <div className="flex-1 mr-3">
          <ConfidenceBar value={egg.confidence} />
        </div>
        <div className="text-xs text-muted-foreground shrink-0 truncate max-w-[160px]">
          <span className="text-muted-foreground/70">from </span>
          <span className="text-foreground/70 italic">{egg.catalyst.theme}</span>
        </div>
      </div>
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] font-mono text-muted-foreground tabular w-8 text-right">
        {pct.toFixed(0)}
      </div>
    </div>
  );
}
