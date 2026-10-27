import { Component, type ReactNode } from 'react';
import { PageProblem } from './PageProblem';
import { tr } from '../i18n/translate';

export class PageLoadBoundary extends Component<{ children: ReactNode; page: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; page: string }>) {
    if (previous.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return (
      <PageProblem title={tr('shell.pageProblem.title')} primaryLabel={tr('common.reload')} onPrimary={() => window.location.reload()} secondaryLabel={tr('common.goBack')} onSecondary={() => window.history.back()}>
        {tr('shell.pageProblem.body')}
      </PageProblem>
    );
    return this.props.children;
  }
}
