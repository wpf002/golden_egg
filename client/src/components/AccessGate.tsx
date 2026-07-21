import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessToken, setAccessToken } from "@/lib/queryClient";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/**
 * Blocks the whole app behind a one-time access-code prompt when the server
 * has an ACCESS_TOKEN configured. With no gate configured (local dev), the
 * probe succeeds immediately and this renders nothing but children.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [code, setCode] = useState("");
  const [rejected, setRejected] = useState(false);

  const probe = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/check`, {
        headers: token ? { "x-access-token": token } : {},
      });
      return res.ok;
    } catch {
      // Network trouble is not an auth failure — let the app render and show
      // its normal error states rather than a misleading lock screen.
      return true;
    }
  };

  useEffect(() => {
    probe(getAccessToken()).then((ok) => setState(ok ? "open" : "locked"));
  }, []);

  const submit = async () => {
    const token = code.trim();
    if (!token) return;
    if (await probe(token)) {
      setAccessToken(token);
      setState("open");
    } else {
      setRejected(true);
    }
  };

  if (state === "open") return <>{children}</>;
  if (state === "checking") return <div className="h-full w-full bg-background" />;

  return (
    <div className="h-full w-full flex items-center justify-center bg-background text-foreground">
      <div className="w-80 border border-card-border bg-card rounded-md p-6">
        <div className="font-display text-lg mb-1">Golden Egg</div>
        <p className="text-sm text-muted-foreground mb-4">
          This dashboard is private. Enter the access code to continue.
        </p>
        <Input
          type="password"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setRejected(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Access code"
          autoFocus
          data-testid="input-access-code"
        />
        {rejected && <p className="text-xs text-rose-400 mt-2">That code didn&rsquo;t work.</p>}
        <Button onClick={submit} className="w-full mt-4" data-testid="button-access-submit">
          Unlock
        </Button>
      </div>
    </div>
  );
}
