import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

/** Keeps one pane's render error from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.label}]`, error); }
  render() {
    if (this.state.error) {
      return (
        <section className="pane">
          <div className="titlebar drag" data-tauri-drag-region />
          <div className="welcome">
            <div className="box">
              <h2>This pane hit an error</h2>
              <p style={{ color: "var(--err)" }}>{String(this.state.error.message || this.state.error)}</p>
              <div className="actions"><button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button></div>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
