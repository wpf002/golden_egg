import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Link2, FileText } from "lucide-react";

/**
 * Paste a URL or raw text to queue a catalyst the automated feeds missed.
 *
 * Costs one cheap-tier LLM call to summarize + place it on a canonical theme;
 * the premium ripple analysis happens on the next scan through the usual cache.
 */
export function AddCatalystDialog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const body = mode === "url" ? { url: url.trim() } : { text: text.trim() };
      const res = await apiRequest("POST", "/api/catalysts/manual", body);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.status === "rejected") {
        // Not an error — the classifier deliberately declined it.
        toast({ title: "Not Queued", description: data.reason });
        return;
      }
      if (data.status === "duplicate") {
        toast({ title: "Already Tracked", description: `"${data.catalyst.title}" is already a catalyst.` });
        setOpen(false);
        return;
      }
      toast({
        title: "Catalyst Queued",
        description: `"${data.catalyst.title}" → ${data.catalyst.theme}. It'll be analyzed on the next scan.`,
      });
      setUrl("");
      setText("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/catalysts"] });
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't Add That", description: e.message, variant: "destructive" }),
  });

  const canSubmit = mode === "url" ? url.trim().length > 0 : text.trim().length > 0;

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-open-add-catalyst">
        <Plus size={14} className="mr-1.5" />
        Add Catalyst
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-card-border bg-card p-4" data-testid="add-catalyst-form">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          <button
            onClick={() => setMode("url")}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${mode === "url" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            data-testid="button-mode-url"
          >
            <Link2 size={12} /> URL
          </button>
          <button
            onClick={() => setMode("text")}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${mode === "text" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            data-testid="button-mode-text"
          >
            <FileText size={12} /> Paste Text
          </button>
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground">
          We'll summarize it now and dig in on the next scan
        </span>
      </div>

      {mode === "url" ? (
        <Input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          data-testid="input-catalyst-url"
        />
      ) : (
        <textarea
          placeholder="Paste the article text here — handy when the page is paywalled…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid="input-catalyst-text"
        />
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          onClick={() => mut.mutate()}
          disabled={!canSubmit || mut.isPending}
          data-testid="button-submit-catalyst"
        >
          {mut.isPending ? "Summarizing…" : "Queue Catalyst"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-catalyst">
          Cancel
        </Button>
      </div>
    </div>
  );
}
