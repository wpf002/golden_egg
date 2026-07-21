import { useQuery } from "@tanstack/react-query";
import type { Catalyst, GoldenEgg } from "@/lib/types";
import { formatRelative } from "@/components/AppShell";
import { ExternalLink, CheckCircle2, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { EggDetailSheet } from "@/components/EggDetailSheet";
import { LoadingSkeleton, ErrorState, EmptyState } from "@/components/QueryState";
import { AddCatalystDialog } from "@/components/AddCatalystDialog";
import { Pagination } from "@/components/Pagination";
import { ThemeProposals } from "@/components/ThemeProposals";

export default function CatalystsPage() {
  const catalystsQ = useQuery<Catalyst[]>({ queryKey: ["/api/catalysts"] });
  const catalysts = catalystsQ.data ?? [];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openEggId, setOpenEggId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const filtered = catalysts.filter(
    (c) =>
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.theme.toLowerCase().includes(search.toLowerCase())
  );

  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggle = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1200px] mx-auto">
      <ThemeProposals />
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search catalysts…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
          data-testid="input-search-catalysts"
        />
        <div className="ml-auto text-xs text-muted-foreground tabular">
          {filtered.length} catalysts · {catalysts.filter((c) => c.rippleAnalyzed).length} analyzed
        </div>
        <AddCatalystDialog />
      </div>

      {catalystsQ.error && (
        <ErrorState
          error={catalystsQ.error}
          label="Couldn't load catalysts"
          onRetry={() => catalystsQ.refetch()}
        />
      )}

      {!catalystsQ.error && catalystsQ.isLoading && <LoadingSkeleton rows={5} />}

      {!catalystsQ.error && !catalystsQ.isLoading && filtered.length === 0 && (
        <EmptyState
          message={search ? "No catalysts match that search." : "No catalysts yet."}
          hint={search ? undefined : "Run a scan to pull in fresh signals."}
        />
      )}

      <div className="flex flex-col gap-3">
        {visible.map((c) => (
          <CatalystRow
            key={c.id}
            c={c}
            open={expanded.has(c.id)}
            onToggle={() => toggle(c.id)}
            onOpenEgg={setOpenEggId}
          />
        ))}
      </div>
      <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />

      <EggDetailSheet eggId={openEggId} onClose={() => setOpenEggId(null)} />
    </div>
  );
}

function CatalystRow({
  c,
  open,
  onToggle,
  onOpenEgg,
}: {
  c: Catalyst;
  open: boolean;
  onToggle: () => void;
  onOpenEgg: (id: number) => void;
}) {
  const { data: detail, isLoading } = useQuery<Catalyst & { eggs: GoldenEgg[] }>({
    queryKey: ["/api/catalysts", c.id],
    enabled: open,
  });
  const eggs = detail?.eggs ?? [];

  return (
    <div className="border border-card-border bg-card rounded-md" data-testid={`row-catalyst-${c.id}`}>
      <div className="p-4 hover-elevate">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-primary font-medium">
                {c.theme}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {c.sourceType.replace("_", " ")}
              </span>
              {c.rippleAnalyzed ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-pos">
                  <CheckCircle2 size={10} /> <span className="uppercase tracking-wider">Analyzed</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock size={10} /> <span className="uppercase tracking-wider">Pending</span>
                </span>
              )}
            </div>
            <h4 className="text-sm font-medium text-foreground leading-snug">{c.title}</h4>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">{c.summary}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-mono tabular text-primary">{(c.strengthScore * 100).toFixed(0)}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">strength</div>
          </div>
        </div>
        <div className="flex items-center gap-4 pt-2 mt-2 border-t border-border/40 text-[11px] text-muted-foreground tabular">
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-foreground/70 hover:text-primary transition-colors"
            data-testid={`button-toggle-catalyst-${c.id}`}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            View Golden Eggs
          </button>
          <span>Seen {formatRelative(c.lastSeenAt)}</span>
          {c.sourceUrl && (
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Source <ExternalLink size={10} />
            </a>
          )}
          {c.rippleCostCredits > 0 && <span>~{c.rippleCostCredits} credits</span>}
        </div>
      </div>

      {open && (
        <div className="border-t border-border/40 bg-background/30 px-4 py-3">
          {isLoading ? (
            <div className="text-xs text-muted-foreground">Loading golden eggs…</div>
          ) : eggs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No golden eggs from this catalyst yet — the analysis found nothing worth flagging.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border/40">
              {eggs.map((e) => (
                <button
                  key={e.id}
                  onClick={() => onOpenEgg(e.id)}
                  className="flex items-center gap-3 py-2 text-left hover:bg-secondary/40 rounded px-2 -mx-2 transition-colors"
                  data-testid={`link-catalyst-egg-${e.id}`}
                >
                  <span className="font-mono text-sm text-primary tabular w-16">{e.ticker}</span>
                  <span className="flex-1 text-sm text-foreground truncate">{e.companyName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Hop {e.hopDistance}
                  </span>
                  <span className="text-[11px] font-mono tabular text-muted-foreground w-12 text-right">
                    {(e.confidence * 100).toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
