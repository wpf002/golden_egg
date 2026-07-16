import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { BacktestResult, BacktestRollup } from "@/lib/types";
import { Play, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function BacktestPage() {
  const { toast } = useToast();
  const [result, setResult] = useState<BacktestResult | null>(null);

  const runMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/backtest/run"),
    onSuccess: async (res) => {
      const j: BacktestResult = await res.json();
      setResult(j);
      toast({
        title: "Backtest complete",
        description: `${j.rows.length} rows · ${j.overall ? `${(j.overall.winRate * 100).toFixed(0)}% win rate` : "no returns yet"}`,
      });
    },
    onError: (e: Error) => toast({ title: "Backtest failed", description: e.message || "Unknown error" }),
  });

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Pragmatic backtest: for every flagged egg, we compute return from the first close on or after its
          flag date through the latest close. Results roll up by theme, sector, and hop distance — one call
          per unique ticker.
        </div>
        <Button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="ml-auto"
          data-testid="button-run-backtest"
        >
          <Play size={14} className={runMut.isPending ? "animate-pulse" : ""} />
          {runMut.isPending ? "Running…" : "Run backtest"}
        </Button>
      </div>

      {result?.priceSource === "spot" && (
        <div
          className="mb-6 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-muted-foreground"
          data-testid="banner-spot-prices"
        >
          <span className="font-medium text-primary">Approximate returns.</span> Your quotes provider&rsquo;s
          plan doesn&rsquo;t include historical daily candles, so the latest refreshed price stands in for the
          closing price. Point-in-time accuracy needs a candles-capable plan.
        </div>
      )}

      {!!result?.suspectCount && (
        <div
          className="mb-6 rounded-md border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-xs text-muted-foreground"
          data-testid="banner-suspect-rows"
        >
          <span className="font-medium text-rose-400">
            {result.suspectCount} {result.suspectCount === 1 ? "egg" : "eggs"} excluded.
          </span>{" "}
          Their recorded flag price looks corrupt (a placeholder left by an early data import), which would
          otherwise produce five-figure returns and skew every rollup.
        </div>
      )}

      {result?.overall && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="Rows scored" value={String(result.overall.count)} />
          <StatCard label="Wins" value={String(result.overall.wins)} />
          <StatCard label="Win rate" value={`${(result.overall.winRate * 100).toFixed(1)}%`} accent="pos" />
          <StatCard
            label="Median return"
            value={`${result.overall.medianReturn >= 0 ? "+" : ""}${result.overall.medianReturn.toFixed(1)}%`}
            accent={result.overall.medianReturn >= 0 ? "pos" : "neg"}
          />
        </div>
      )}

      {!result && !runMut.isPending && (
        <div className="border border-dashed border-border rounded-md py-16 text-center text-sm text-muted-foreground">
          <TrendingUp size={24} strokeWidth={1.5} className="mx-auto mb-3 text-muted-foreground/50" />
          <div className="mb-1 text-foreground">Ready to backtest</div>
          Click "Run backtest" to fetch daily closes and score every egg.
        </div>
      )}

      {runMut.isPending && (
        <div className="border border-dashed border-border rounded-md py-16 text-center text-sm text-muted-foreground">
          Fetching daily closes… this can take 30–90 seconds.
        </div>
      )}

      {result && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <RollupTable title="By theme" rows={result.byTheme} keyLabel="Theme" />
          <RollupTable title="By sector" rows={result.bySector} keyLabel="Sector" />
          <RollupTable title="By hop distance" rows={result.byHop} keyLabel="Hop" />
          <div />
        </div>
      )}

      {result && result.rows.length > 0 && (
        <div className="border border-card-border bg-card rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
            Per-egg returns ({result.rows.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Company</th>
                  <th className="px-3 py-2 text-left">Theme</th>
                  <th className="px-3 py-2 text-right">Hop</th>
                  <th className="px-3 py-2 text-right">Flag date</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2 text-right">Flag close</th>
                  <th className="px-3 py-2 text-right">Latest</th>
                  <th className="px-3 py-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {result.rows
                  .slice()
                  .sort((a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity))
                  .map((r) => (
                    <tr
                      key={r.eggId}
                      className="border-b border-border/40 hover-elevate"
                      data-testid={`row-backtest-${r.eggId}`}
                    >
                      <td className="px-3 py-2 font-mono text-primary tabular">{r.ticker}</td>
                      <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{r.companyName}</td>
                      <td className="px-3 py-2 text-muted-foreground italic">{r.theme}</td>
                      <td className="px-3 py-2 text-right tabular">{r.hopDistance}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular">{r.flagDate}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular">{r.daysHeld}</td>
                      <td className="px-3 py-2 text-right font-mono tabular">
                        {r.flagClose == null ? "—" : `$${r.flagClose.toFixed(2)}`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular">
                        {r.latestClose == null ? "—" : `$${r.latestClose.toFixed(2)}`}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular ${
                          r.returnPct == null
                            ? "text-muted-foreground"
                            : r.returnPct > 0
                              ? "text-emerald-400"
                              : r.returnPct < 0
                                ? "text-rose-400"
                                : "text-muted-foreground"
                        }`}
                      >
                        {r.returnPct == null
                          ? "—"
                          : `${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RollupTable({ title, rows, keyLabel }: { title: string; rows: BacktestRollup[]; keyLabel: string }) {
  return (
    <div className="border border-card-border bg-card rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground italic">No scored rows yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{keyLabel}</th>
              <th className="px-3 py-2 text-right">N</th>
              <th className="px-3 py-2 text-right">Win rate</th>
              <th className="px-3 py-2 text-right">Median</th>
              <th className="px-3 py-2 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/40">
                <td className="px-3 py-2 text-foreground truncate max-w-[140px]">{r.key}</td>
                <td className="px-3 py-2 text-right text-muted-foreground tabular">{r.count}</td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular ${r.winRate >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {(r.winRate * 100).toFixed(0)}%
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular ${
                    r.medianReturn == null
                      ? "text-muted-foreground"
                      : r.medianReturn > 0
                        ? "text-emerald-400"
                        : r.medianReturn < 0
                          ? "text-rose-400"
                          : "text-muted-foreground"
                  }`}
                >
                  {r.medianReturn == null
                    ? "—"
                    : `${r.medianReturn >= 0 ? "+" : ""}${r.medianReturn.toFixed(1)}%`}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular ${
                    r.avgReturn == null
                      ? "text-muted-foreground"
                      : r.avgReturn > 0
                        ? "text-emerald-400"
                        : r.avgReturn < 0
                          ? "text-rose-400"
                          : "text-muted-foreground"
                  }`}
                >
                  {r.avgReturn == null ? "—" : `${r.avgReturn >= 0 ? "+" : ""}${r.avgReturn.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  const color =
    accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-rose-400" : "text-foreground";
  return (
    <div className="border border-card-border bg-card rounded-md p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{label}</div>
      <div className={`text-xl font-display tabular ${color}`}>{value}</div>
    </div>
  );
}
