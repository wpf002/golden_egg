import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { Sparkles, Zap, Network, Star, Activity, LineChart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { PriceAlert } from "@/lib/types";

const navItems = [
  { href: "/", label: "Overview", icon: Sparkles },
  { href: "/eggs", label: "Golden Eggs", icon: Zap },
  { href: "/catalysts", label: "Catalysts", icon: Activity },
  { href: "/graph", label: "Supply Graph", icon: Network },
  { href: "/backtest", label: "Backtest", icon: LineChart },
  { href: "/watchlist", label: "Watchlist", icon: Star },
];

/**
 * Responsive shell: the 240px sidebar exists from lg: up. Below that,
 * navigation moves to a fixed bottom tab bar (thumb-reachable on phones and
 * tablets) and the header shows the logo. Main content is the only scroll
 * region in both layouts.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: alerts } = useQuery<PriceAlert[]>({ queryKey: ["/api/alerts"] });
  const openAlerts = (alerts ?? []).filter((a) => !a.acknowledgedAt).length;

  const isActive = (href: string) => location === href || (href !== "/" && location.startsWith(href));

  return (
    <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[240px_1fr] grid-rows-[auto_1fr] bg-background text-foreground">
      {/* Sidebar — desktop only */}
      <aside
        className="hidden lg:flex row-span-2 border-r border-sidebar-border bg-sidebar flex-col overflow-y-auto"
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
            const active = isActive(item.href);
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
                {item.href === "/watchlist" && openAlerts > 0 && (
                  <span
                    className="ml-auto rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] leading-none tabular text-primary-foreground"
                    data-testid="badge-open-alerts"
                    title={`${openAlerts} unread price ${openAlerts === 1 ? "alert" : "alerts"}`}
                  >
                    {openAlerts}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Header */}
      <header className="lg:col-start-2 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10 px-4 md:px-8 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="lg:hidden text-primary shrink-0">
            <Logo size={22} />
          </span>
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-sm font-medium tracking-tight text-foreground whitespace-nowrap">
              {pageTitle(location)}
            </h1>
            <span className="hidden sm:inline text-xs text-muted-foreground truncate">
              {pageSubtitle(location)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-pos"></span>Live
          </span>
        </div>
      </header>

      {/* Main scroll region — bottom padding clears the mobile tab bar */}
      <main
        className="lg:col-start-2 overflow-y-auto pb-20 lg:pb-0"
        style={{ overscrollBehavior: "contain" }}
      >
        {children}
      </main>

      {/* Bottom tab bar — phones and tablets */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 backdrop-blur flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] tracking-wide transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
              data-testid={`tab-${item.label.toLowerCase().replace(" ", "-")}`}
            >
              <item.icon size={18} strokeWidth={active ? 2 : 1.75} />
              <span className="uppercase">{item.label.split(" ").pop()}</span>
              {item.href === "/watchlist" && openAlerts > 0 && (
                <span className="absolute top-1 right-[calc(50%-16px)] w-2 h-2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>
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
  if (loc === "/") return "What's moving, and who quietly benefits";
  if (loc.startsWith("/eggs")) return "The stocks our catalysts point to";
  if (loc.startsWith("/catalysts")) return "The news and filings we're tracking";
  if (loc.startsWith("/graph")) return "How catalysts ripple through supply chains";
  if (loc.startsWith("/backtest")) return "How the picks have actually done";
  if (loc.startsWith("/watchlist")) return "Stocks you're keeping an eye on";
  return "";
}

export function formatRelative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
