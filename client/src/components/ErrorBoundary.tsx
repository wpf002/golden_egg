import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time errors so one broken component doesn't blank the whole
 * app. React has no hook equivalent — an error boundary must be a class.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Phase 4 wires this to real error tracking (Sentry et al).
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center"
        data-testid="error-boundary-fallback"
      >
        <AlertTriangle className="h-10 w-10 text-rose-400" />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Something broke on this screen</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            The rest of the app is still fine — you can retry, or navigate elsewhere.
          </p>
        </div>
        <pre className="max-w-lg overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-muted-foreground">
          {error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="button-retry-error-boundary"
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }
}
