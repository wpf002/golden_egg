import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { GoldenEggWithCatalyst } from "@/lib/types";
import { EggCard } from "@/components/EggCard";
import { EggDetailSheet } from "@/components/EggDetailSheet";
import { AlertsPanel } from "@/components/AlertsPanel";

export default function WatchlistPage() {
  const { data: watchlist = [], isLoading } = useQuery<GoldenEggWithCatalyst[]>({
    queryKey: ["/api/watchlist"],
  });
  const [openEggId, setOpenEggId] = useState<number | null>(null);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 border border-card-border rounded-md bg-card animate-pulse" />
          ))}
        </div>
      ) : watchlist.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-16 text-center text-sm text-muted-foreground max-w-lg mx-auto mt-16">
          <div className="mb-2 font-display text-lg text-foreground">Your watchlist is empty</div>
          Star an egg on any page to track it here.
        </div>
      ) : (
        <>
          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Price alerts</h3>
              <span className="text-xs text-muted-foreground/70">Checked on every price refresh — free</span>
            </div>
            <AlertsPanel />
          </section>

          <div className="mb-6 text-xs text-muted-foreground tabular">
            Tracking {watchlist.length} {watchlist.length === 1 ? "position" : "positions"}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {watchlist.map((e) => (
              <EggCard key={e.id} egg={e} onOpen={setOpenEggId} />
            ))}
          </div>
        </>
      )}
      <EggDetailSheet eggId={openEggId} onClose={() => setOpenEggId(null)} />
    </div>
  );
}
