import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, X, Send } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "What's the strongest pick right now, and why?",
  "Which themes are actually working?",
  "Any picks where the data disagrees with the confidence?",
];

/**
 * Ask-the-app chat. Answers come from the server, which grounds them in the
 * app's own eggs, track record and graph — so this is a way to interrogate the
 * data, not a general-purpose chatbot.
 */
export function AssistantSheet() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const askMut = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/chat", { question, history: turns });
      return (await res.json()) as { answer: string };
    },
    onSuccess: (d) => setTurns((t) => [...t, { role: "assistant", content: d.answer }]),
    onError: (e: Error) =>
      setTurns((t) => [...t, { role: "assistant", content: `Couldn't answer that: ${e.message}` }]),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, askMut.isPending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || askMut.isPending) return;
    setTurns((t) => [...t, { role: "user", content: question }]);
    setDraft("");
    askMut.mutate(question);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 bottom-[4.75rem] lg:right-6 lg:bottom-6 z-30 h-11 w-11 lg:h-12 lg:w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label="Open AI chat"
        data-testid="button-open-assistant"
      >
        <MessageSquare size={20} />
      </button>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 lg:inset-x-auto lg:right-6 lg:bottom-6 z-30 lg:w-[420px] h-[70vh] lg:h-[560px] border border-card-border bg-background rounded-t-lg lg:rounded-lg shadow-2xl flex flex-col"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="assistant-panel"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <MessageSquare size={14} className="text-primary" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground">AI Chat</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Close"
          data-testid="button-close-assistant"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ overscrollBehavior: "contain" }}>
        {turns.length === 0 && (
          <div className="text-sm text-muted-foreground">
            <p className="mb-3 leading-relaxed">
              Ask about the picks, the themes, or how they&rsquo;ve done. Answers come from this app&rsquo;s
              own data — not the open internet.
            </p>
            <div className="flex flex-col gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-xs text-primary hover:underline"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm leading-relaxed whitespace-pre-wrap ${
              t.role === "user"
                ? "bg-secondary text-foreground rounded-md px-3 py-2 ml-6"
                : "text-foreground/85 mr-2"
            }`}
          >
            {t.content}
          </div>
        ))}
        {askMut.isPending && <div className="text-sm text-muted-foreground">Reading the data…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 flex items-center gap-2 shrink-0">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(draft)}
          placeholder="Ask about your picks…"
          disabled={askMut.isPending}
          data-testid="input-assistant"
        />
        <Button
          size="sm"
          onClick={() => send(draft)}
          disabled={!draft.trim() || askMut.isPending}
          data-testid="button-send-assistant"
        >
          <Send size={14} />
        </Button>
      </div>
    </div>
  );
}
