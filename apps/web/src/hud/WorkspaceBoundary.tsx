import { Component, type ReactNode } from "react";

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && /failed to fetch dynamically imported module|loading chunk|importing a module script failed|error loading dynamically imported module/i.test(error.message);
}

type Props = { children: ReactNode; onReload?: () => void };
type State = { error: Error | null };

/** Keep the shell and recorded evidence alive when an optional workspace fails. */
export class WorkspaceBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error("Workspace render failed") };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="analysis-card workspace-recovery" role="alert">
      <h3>{isChunkLoadError(this.state.error) ? "This workspace could not finish loading." : "This workspace could not be displayed."}</h3>
      <p>{isChunkLoadError(this.state.error)
        ? "The connection may have been interrupted, or a newer release may be available. You can open another workspace or refresh to load the latest release."
        : "Your other workspaces remain available. Refresh to try again; if the problem persists, keep your exported evidence and report the issue."}</p>
      <p>Reload checks locally saved reports and restores your city. Unsaved input edits may be lost.</p>
      <button type="button" className="next-step" onClick={this.props.onReload ?? (() => window.location.reload())}>Refresh workspace</button>
    </section>;
  }
}
