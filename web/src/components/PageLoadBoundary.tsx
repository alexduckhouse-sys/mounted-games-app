import { Component, type ReactNode } from 'react';
import { PageProblem } from './PageProblem';

export class PageLoadBoundary extends Component<{ children: ReactNode; page: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; page: string }>) {
    if (previous.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return (
      <PageProblem title="This page couldn’t open" primaryLabel="Reload page" onPrimary={() => window.location.reload()} secondaryLabel="Go back" onSecondary={() => window.history.back()}>
        Check your signal, then reload.
      </PageProblem>
    );
    return this.props.children;
  }
}
