import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBar, useCompactPageBarState, usePageHeader, type CompactPageBarConfig } from './CompactPageBarContext';

const first: CompactPageBarConfig = { backTo: '/one', title: 'Spring Games', subtitle: 'Seniors heats · Main Arena', badge: 'live' };
const second: CompactPageBarConfig = { backTo: '/two', title: 'Autumn Games', subtitle: 'Juniors heats · Arena Two', badge: 'next' };

function Publish({ config }: { config: CompactPageBarConfig }) {
  useCompactPageBar(config);
  return null;
}

function Read() {
  const { config } = useCompactPageBarState();
  return <output data-testid="compact-config">{config ? JSON.stringify(config) : 'none'}</output>;
}

it('publishes a compact bar while its page is mounted and clears it on route cleanup', () => {
  const view = (show: boolean) => <CompactPageBarProvider><Read />{show && <Publish config={first} />}</CompactPageBarProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Spring Games');
  rerender(view(false));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('none');
});

it('does not let an older page cleanup clear the current page bar', () => {
  const view = (showFirst: boolean) => <CompactPageBarProvider><Read />{showFirst && <Publish config={first} />}<Publish config={second} /></CompactPageBarProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Autumn Games');
  rerender(view(false));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Autumn Games');
});

it('fails clearly when a compact page tries to publish outside the app provider', () => {
  expect(() => render(<Publish config={first} />)).toThrow('useCompactPageBarState must be used within CompactPageBarProvider');
});

function Header({ onRefresh, title = 'Timetable' }: { onRefresh?: () => void; title?: string }) {
  usePageHeader({ title, subtitle: 'Spring Games · 10:54', onRefresh, refreshLabel: 'Refresh timetable' });
  return null;
}

function ReadHeader() {
  const { header } = useCompactPageBarState();
  return <output data-testid="page-header">{header ? `${header.title}|${header.subtitle}|${header.refreshLabel}|${header.refresh ? 'refresh' : 'none'}` : 'none'}</output>;
}

it('publishes a page header with a refresh that always calls the latest callback, and clears it on unmount', () => {
  const first = vi.fn();
  const second = vi.fn();
  const view = (show: boolean, cb: () => void) => <CompactPageBarProvider><ReadHeader />{show && <Header onRefresh={cb} />}</CompactPageBarProvider>;
  const { rerender } = render(view(true, first));
  expect(screen.getByTestId('page-header')).toHaveTextContent('Timetable|Spring Games · 10:54|Refresh timetable|refresh');
  rerender(view(true, second));
  // The same header stays published; only the callback it runs changes.
  function Probe() { const { header } = useCompactPageBarState(); return <button onClick={header?.refresh}>go</button>; }
  rerender(<CompactPageBarProvider><Probe /><Header onRefresh={second} /></CompactPageBarProvider>);
  act(() => screen.getByText('go').click());
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  rerender(view(false, second));
  expect(screen.getByTestId('page-header')).toHaveTextContent('none');
});

it('leaves out the refresh button when the page has none, and ignores usePageHeader outside the provider', () => {
  render(<CompactPageBarProvider><ReadHeader /><Header /></CompactPageBarProvider>);
  expect(screen.getByTestId('page-header')).toHaveTextContent('|none');
  expect(() => render(<Header />)).not.toThrow();
});

it('passes on that a header is plain, for pages that belong to no competition', () => {
  function Plain() { usePageHeader({ title: 'Following', subtitle: '5 teams · 2 events', plain: true, backTo: '/dashboard', backLabel: 'Back to Me' }); return null; }
  function ReadPlain() { const { header } = useCompactPageBarState(); return <output data-testid="plain">{header?.plain ? 'plain' : 'button'}|{header?.backTo}|{header?.backLabel}</output>; }
  render(<CompactPageBarProvider><ReadPlain /><Plain /></CompactPageBarProvider>);
  expect(screen.getByTestId('plain')).toHaveTextContent('plain|/dashboard|Back to Me');
});
