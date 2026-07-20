import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PriceAlert } from "@/lib/types";
import { formatRelative } from "@/components/AppShell";
import { TrendingUp, TrendingDown, Check } from "lucide-react";
import { LoadingSkeleton, ErrorState, EmptyState } from "@/components/QueryState";

/**
 * Alerts raised when a watchlist egg's return-vs-flag crosses the threshold.
 * Evaluated during a price refresh — quote data only, so it costs nothing.
 */
export function AlertsPanel() {
  const qc = useQueryClient();
  const alertsQ = useQuery<PriceAlert[]>({ queryKey: ["/api/alerts"] });

  const ackMut = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/alerts/${id}/ack`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });
  const ackAllMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/alerts/ack-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  if (alertsQ.isLoading) return <LoadingSkeleton rows={2} />;
  if (alertsQ.error)
    return (
      <ErrorState error={alertsQ.error} label="Couldn't load alerts" onRetry={() => alertsQ.refetch()} />
    );

  const alerts = alertsQ.data ?? [];
  const open = alerts.filter((a) => !a.acknowledgedAt);

  if (alerts.length === 0) {
    return (
      <EmptyState
        message="No price alerts yet."
        hint="Refresh prices and we'll flag anything on your watchlist that's moved sharply since you flagged it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="alerts-panel">
      {open.length > 1 && (
        <button
          onClick={() => ackAllMut.mutate()}
          disabled={ackAllMut.isPending}
          className="self-end text-xs text-primary hover:underline"
          data-testid="button-ack-all-alerts"
        >
          Dismiss All ({open.length})
        </button>
      )}
      {alerts.map((a) => {
        const gain = a.direction === "gain";
        const Icon = gain ? TrendingUp : TrendingDown;
        const acked = !!a.acknowledgedAt;
        return (
          <div
            key={a.id}
            className={[
              "flex items-center gap-3 rounded-md border p-3",
              acked
                ? "border-border/40 opacity-50"
                : gain
                  ? "border-emerald-400/30 bg-emerald-400/5"
                  : "border-rose-400/30 bg-rose-400/5",
            ].join(" ")}
            data-testid={`alert-${a.id}`}
          >
            <Icon size={16} className={gain ? "text-emerald-400" : "text-rose-400"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm tracking-wider text-foreground">{a.ticker}</span>
                <span className="truncate text-xs text-muted-foreground">{a.companyName}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className={`font-mono tabular ${gain ? "text-emerald-400" : "text-rose-400"}`}>
                  {a.returnPct > 0 ? "+" : ""}
                  {a.returnPct.toFixed(1)}%
                </span>{" "}
                vs flag · crossed {a.thresholdPct}% · {formatRelative(a.createdAt)}
              </div>
            </div>
            {!acked && (
              <button
                onClick={() => ackMut.mutate(a.id)}
                disabled={ackMut.isPending}
                className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Dismiss"
                data-testid={`button-ack-alert-${a.id}`}
              >
                <Check size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
