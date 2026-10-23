import { Component, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

/** Show a friendly message instead of a blank screen if a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="panel panel-body" style={{ maxWidth: 520, margin: "40px auto", alignItems: "flex-start" }}>
          <CircleAlert style={{ color: "var(--danger)" }} />
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p className="muted">This screen hit an unexpected error. Your files never left your device. Reload to try again.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn" href="#/" onClick={() => this.setState({ error: null })}>
              All tools
            </a>
          </div>
        </div>
      </div>
    );
  }
}
