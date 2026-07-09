import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/AppShell";
import Overview from "@/pages/Overview";
import EggsPage from "@/pages/Eggs";
import CatalystsPage from "@/pages/Catalysts";
import GraphPage from "@/pages/Graph";
import WatchlistPage from "@/pages/Watchlist";
import BacktestPage from "@/pages/Backtest";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/eggs" component={EggsPage} />
      <Route path="/catalysts" component={CatalystsPage} />
      <Route path="/graph" component={GraphPage} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route path="/backtest" component={BacktestPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppShell>
            <AppRouter />
          </AppShell>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
