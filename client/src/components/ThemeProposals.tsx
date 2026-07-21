import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Lightbulb } from "lucide-react";

type Proposal = {
  id: number;
  name: string;
  rationale: string;
  evidence: string[];
  status: "pending" | "approved" | "dismissed";
  createdAt: number;
};

/**
 * The theme scout's inbox. The scan clusters catalysts it couldn't file under
 * any current theme into proposed NEW themes; nothing changes until one is
 * approved here — then the classifier starts using it on the next scan.
 */
export function ThemeProposals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const proposalsQ = useQuery<Proposal[]>({ queryKey: ["/api/themes/proposals"] });
  const pending = (proposalsQ.data ?? []).filter((p) => p.status === "pending");

  const decideMut = useMutation({
    mutationFn: async ({ id, approve }: { id: number; approve: boolean }) =>
      apiRequest("POST", `/api/themes/proposals/${id}/decide`, { approve }),
    onSuccess: (_r, { approve }) => {
      toast({
        title: approve ? "Theme Approved" : "Proposal Dismissed",
        description: approve
          ? "The classifier will file catalysts under it starting with the next scan."
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ["/api/themes/proposals"] });
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't Save That", description: e.message, variant: "destructive" }),
  });

  if (pending.length === 0) return null;

  return (
    <div className="mb-6 border border-primary/30 bg-primary/5 rounded-md" data-testid="theme-proposals">
      <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
        <Lightbulb size={14} className="text-primary" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Proposed New Themes</span>
        <span className="text-[11px] text-muted-foreground/70 ml-auto">
          Recurring patterns the scanner found outside its current themes
        </span>
      </div>
      {pending.map((p) => (
        <div key={p.id} className="px-4 py-3 border-b border-border/40 last:border-b-0">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground font-medium mb-1">{p.name}</div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">{p.rationale}</p>
              <div className="text-[11px] text-muted-foreground/70">
                {p.evidence.slice(0, 3).map((t, i) => (
                  <div key={i} className="truncate">
                    · {t}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                onClick={() => decideMut.mutate({ id: p.id, approve: true })}
                disabled={decideMut.isPending}
                data-testid={`button-approve-theme-${p.id}`}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decideMut.mutate({ id: p.id, approve: false })}
                disabled={decideMut.isPending}
                data-testid={`button-dismiss-theme-${p.id}`}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
