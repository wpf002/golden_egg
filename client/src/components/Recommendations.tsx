import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, AlertTriangle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

type Recommendation = {
  title: string;
  detail: string;
  tickers: string[];
  kind: "opportunity" | "risk" | "housekeeping";
};

const ICON = {
  opportunity: Sparkles,
  risk: AlertTriangle,
  housekeeping: ListChecks,
};
const TONE = {
  opportunity: "text-primary",
  risk: "text-rose-400",
  housekeeping: "text-muted-foreground",
};

/**
 * What the app thinks is worth your attention, derived from its own picks,
 * realized results and coattail figures. Server-cached for 30 minutes because
 * each rebuild is a premium call.
 */
export function Recommendations() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery<{ recommendations: Recommendation[]; asOf: number }>({
    queryKey: ["/api/recommendations"],
  });
  const recs = q.data?.recommendations ?? [];

  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiRequest("GET", "/api/recommendations?refresh=true");
      await qc.invalidateQueries({ queryKey: ["/api/recommendations"] });
    } finally {
      setRefreshing(false);
    }
  };

  if (q.isLoading) {
    return (
      <div className="mb-10 border border-card-border bg-card rounded-md px-4 py-6 text-sm text-muted-foreground">
        Working out what matters right now…
      </div>
    );
  }
  if (recs.length === 0) return null;

  return (
    <section className="mb-10" data-testid="recommendations">
      <div className="flex items-baseline justify-between mb-4 gap-3">
        <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Worth Your Attention</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          data-testid="button-refresh-recs"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin mr-1.5" : "mr-1.5"} />
          {refreshing ? "Rethinking…" : "Refresh"}
        </Button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {recs.map((r, i) => {
          const Icon = ICON[r.kind];
          return (
            <div
              key={i}
              className="border border-card-border bg-card rounded-md p-4"
              data-testid={`rec-${i}`}
            >
              <div className="flex items-start gap-2.5">
                <Icon size={14} className={`${TONE[r.kind]} mt-0.5 shrink-0`} strokeWidth={1.75} />
                <div className="min-w-0">
                  <div className="text-sm text-foreground font-medium mb-1">{r.title}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{r.detail}</p>
                  {r.tickers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.tickers.map((t) => (
                        <span
                          key={t}
                          className="font-mono text-[11px] text-primary bg-primary-subtle px-1.5 py-0.5 rounded tabular"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
