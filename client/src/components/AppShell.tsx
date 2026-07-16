import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { Sparkles, Zap, Network, Star, Activity, LineChart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ScanRun } from "@/lib/types";

const navItems = [
  { href: "/", label: "Overview", icon: Sparkles },
  { href: "/eggs", label: "Golden Eggs", icon: Zap },
  { href: "/catalysts", label: "Catalysts", icon: Activity },
  { href: "/graph", label: "Supply Graph", icon: Network },
  { href: "/backtest", label: "Backtest", icon: LineChart },
  { href: "/watchlist", label: "Watchlist", icon: Star },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: latestScan } = useQuery<ScanRun | null>({
    queryKey: ["/api/scans/latest"],
    refetchInterval: 60_000,
  });

  return (
    <div className="dark h-full w-full grid grid-cols-[240px_1fr] grid-rows-[auto_1fr] bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className="row-span-2 border-r border-sidebar-border bg-sidebar flex flex-col overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="px-5 py-5 flex items-center gap-2.5 text-primary">
          <Logo size={26} />
          <div className="leading-tight">
            <div className="font-display text-base font-semibold text-foreground tracking-tight">
              Golden Egg
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              parallel markets
            </div>
          </div>
        </div>
        <nav className="px-3 pt-2 pb-4 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors ${
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
              >
                <item.icon size={15} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-5 py-4 border-t border-sidebar-border text-[11px] text-muted-foreground tabular">
          {latestScan ? (
            <>
              <div className="uppercase tracking-widest text-[9px] mb-1 text-muted-foreground/70">
                Last scan
              </div>
              <div className="text-foreground">{formatRelative(latestScan.startedAt)}</div>
              <div className="mt-1">
                <span className="text-primary">{latestScan.eggsCreated}</span> eggs ·{" "}
                <span>{latestScan.cacheHits}</span> cached · ~<span>{latestScan.approxCredits}</span> credits
              </div>
            </>
          ) : (
            <>
              <div className="uppercase tracking-widest text-[9px] mb-1 text-muted-foreground/70">Status</div>
              <div>No scan yet</div>
            </>
          )}
        </div>
      </aside>

      {/* Header */}
      <header className="col-start-2 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10 px-8 h-14 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium tracking-tight text-foreground">{pageTitle(location)}</h1>
          <span className="text-xs text-muted-foreground">{pageSubtitle(location)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-pos"></span>Live
          </span>
        </div>
      </header>

      {/* Main scroll region */}
      <main className="col-start-2 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {children}
      </main>
    </div>
  );
}

function pageTitle(loc: string) {
  if (loc === "/") return "Overview";
  if (loc.startsWith("/eggs")) return "Golden Eggs";
  if (loc.startsWith("/catalysts")) return "Catalysts";
  if (loc.startsWith("/graph")) return "Supply Graph";
  if (loc.startsWith("/backtest")) return "Backtest";
  if (loc.startsWith("/watchlist")) return "Watchlist";
  return "Golden Egg";
}
function pageSubtitle(loc: string) {
  if (loc === "/") return "Trending catalysts and top parallel plays";
  if (loc.startsWith("/eggs")) return "Non-obvious ripple beneficiaries";
  if (loc.startsWith("/catalysts")) return "Emerging market drivers";
  if (loc.startsWith("/graph")) return "Supply-chain ripple network";
  if (loc.startsWith("/backtest")) return "Score every flagged egg vs. current price";
  if (loc.startsWith("/watchlist")) return "Tracked positions";
  return "";
}

export function formatRelative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
