import { AlertCircle, RotateCcw } from "lucide-react";

/**
 * Shared loading/error presentation for TanStack Query screens.
 *
 * Before this, pages defaulted data to `[]` and rendered nothing while loading
 * (indistinguishable from "no results"), and `isError` was never handled at all
 * — a failed fetch looked like an empty dashboard.
 */

export function LoadingSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} data-testid="loading-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-muted/40" />
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  label = "Couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  label?: string;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-400/30 bg-rose-400/5 p-8 text-center"
      data-testid="error-state"
    >
      <AlertCircle className="h-6 w-6 text-rose-400" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="max-w-md font-mono text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          data-testid="button-retry-query"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-8 text-center"
      data-testid="empty-state"
    >
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
