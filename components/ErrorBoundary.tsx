"use client";

/**
 * ErrorBoundary — catches render-time exceptions thrown by the card deck or the
 * transaction terminal (unexpected Web3 / execution errors, a dropped node, a
 * malformed SwapVM response) so they never crash the Telegram webview.
 *
 * Instead of a blank screen it renders a small, non-intrusive glass badge
 * ("Execution paused: Check RPC/API connection") with a Retry action that
 * clears the boundary and re-mounts the wrapped subtree.
 *
 * This is deliberately a class component — React only exposes error boundaries
 * through `getDerivedStateFromError` / `componentDidCatch`.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback headline. Defaults to the RPC/API connection message. */
  label?: string;
  /** Ran after Retry clears the boundary — e.g. to reset upstream swap state. */
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const DEFAULT_LABEL = "Execution paused: Check RPC/API connection";

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for debugging without bubbling to the webview's crash screen.
    console.error("[SwipeFi/ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { label = DEFAULT_LABEL } = this.props;

    return (
      <div
        role="alert"
        className="mx-auto my-4 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-amber-400/30 bg-slate-950/60 px-4 py-3 text-left shadow-lg shadow-black/30 backdrop-blur-md"
      >
        {/* pulsing amber status dot */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-200">{label}</p>
          <p className="truncate font-mono text-[10px] text-slate-500">
            {this.state.error?.message ?? "unknown render error"}
          </p>
        </div>

        <button
          type="button"
          onClick={this.handleRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }
}
