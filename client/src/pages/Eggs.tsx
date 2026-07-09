import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import type { GoldenEggWithCatalyst } from "@/lib/types";
import { EggCard } from "@/components/EggCard";
import { EggDetailSheet } from "@/components/EggDetailSheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function EggsPage() {
  const { data: eggs = [], isLoading } = useQuery<GoldenEggWithCatalyst[]>({ queryKey: ["/api/eggs"] });
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [minConf, setMinConf] = useState("0.5");
  const [sortBy, setSortBy] = useState("score");
  const [openEggId, setOpenEggId] = useState<number | null>(null);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    eggs.forEach((e) => e.sector && s.add(e.sector));
    return ["all", ...Array.from(s).sort()];
  }, [eggs]);

  const filtered = useMemo(() => {
    let out = eggs.filter((e) => e.confidence >= Number(minConf));
    if (sector !== "all") out = out.filter((e) => e.sector === sector);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((e) =>
        e.ticker.toLowerCase().includes(q) ||
        e.companyName.toLowerCase().includes(q) ||
        e.thesis.toLowerCase().includes(q) ||
        e.catalyst.theme.toLowerCase().includes(q),
      );
    }
    if (sortBy === "score") out.sort((a, b) => b.confidence * (1 + b.noveltyScore) - a.confidence * (1 + a.noveltyScore));
    else if (sortBy === "conf") out.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "novelty") out.sort((a, b) => b.noveltyScore - a.noveltyScore);
    else if (sortBy === "recent") out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [eggs, search, sector, minConf, sortBy]);

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search ticker, thesis, theme…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-eggs"
        />
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Sector" /></SelectTrigger>
          <SelectContent>
            {sectors.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All sectors" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minConf} onValueChange={setMinConf}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Confidence" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any</SelectItem>
            <SelectItem value="0.5">≥ 50%</SelectItem>
            <SelectItem value="0.7">≥ 70%</SelectItem>
            <SelectItem value="0.85">≥ 85%</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Best score</SelectItem>
            <SelectItem value="conf">Confidence</SelectItem>
            <SelectItem value="novelty">Most novel</SelectItem>
            <SelectItem value="recent">Most recent</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground tabular">
          {filtered.length} of {eggs.length}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 border border-card-border rounded-md bg-card animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-16 text-center text-sm text-muted-foreground">
          No eggs match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map((egg) => <EggCard key={egg.id} egg={egg} onOpen={setOpenEggId} />)}
        </div>
      )}
      <EggDetailSheet eggId={openEggId} onClose={() => setOpenEggId(null)} />
    </div>
  );
}
