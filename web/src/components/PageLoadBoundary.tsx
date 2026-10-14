import { Component, type ReactNode } from 'react';

export class PageLoadBoundary extends Component<{ children: ReactNode; page: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; page: string }>) {
    if (previous.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return (
      <div className="card space-y-3 p-4" role="alert">
        <p>This page couldn’t open. Check your connection and reload to try again.</p>
        <button className="btn-primary min-h-11" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    );
    return this.props.children;
  }
}
