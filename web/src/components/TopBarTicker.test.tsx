import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import type { TickerItem } from '../lib/ticker';
import { TickerProvider, useTicker, type DockAction } from './TickerContext';
import { TopBarTicker } from './TopBarTicker';

const live: TickerItem = { key: 'live-1', kind: 'live', text: 'Now: Seniors Session 1 · Heat 1' };
const next: TickerItem = { key: 'next-2', kind: 'next', text: 'Next 10:30: Seniors Session 1 · Heat 2' };
const info: TickerItem = { key: 'info', kind: 'info', text: 'Spring Games' };
const notice: TickerItem = { key: 'announcement-7', kind: 'announcement', text: 'Lunch moved to 1pm' };

function Publish({ items, watch = null, action = null }: { items: TickerItem[]; watch?: number | null; action?: DockAction | null }) {
  const { setItems, setWatchCompetitionId, setDockAction } = useTicker();
  useEffect(() => { setWatchCompetitionId(watch); }, [watch, setWatchCompetitionId]);
  useEffect(() => { setItems(items); }, [items, setItems]);
  useEffect(() => { setDockAction(action); }, [action, setDockAction]);
  return null;
}
function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>Go {to}</button>;
}
function Page({ items, watch = null, action = null, low }: { items: TickerItem[]; watch?: number | null; action?: DockAction | null; low?: boolean }) {
  return (
    <MemoryRouter initialEntries={['/competitions/1']}>
      <CurrentCompetitionProvider>
        <TickerProvider>
          <Publish items={items} watch={watch} action={action} />
          <TopBarTicker low={low} />
          <Go to="/competitions/1/chat" />
          <button>Outside</button>
        </TickerProvider>
      </CurrentCompetitionProvider>
    </MemoryRouter>
  );
}
const remember = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 1, name: 'Spring Games' }))}; Path=/`; };
const show = (items: TickerItem[]) => render(<Page items={items} />);
// The line now showing; the one it pushed out stays behind it until its slide ends.
const strip = () => document.querySelector('.ticker-line:not(.ticker-out)')?.textContent ?? null;
const leaving = () => document.querySelector('.ticker-out')?.textContent ?? null;
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function stubMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    matches: reduce,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  }));
  return listeners;
}

beforeEach(() => { vi.useFakeTimers(); remember(); });
afterEach(() => { vi.useRealTimers(); });

describe('TopBarTicker: what it shows', () => {
  it('sits at the bottom of the screen on a page with no tab bar', () => {
    const { unmount } = render(<Page items={[live]} low />);
    expect(document.querySelector('.mg-dock')).toHaveClass('mg-dock-low');
    unmount();
    show([live]);
    expect(document.querySelector('.mg-dock')).not.toHaveClass('mg-dock-low');
  });

  it('shows nothing when there is no competition or nothing to say', () => {
    document.cookie = 'mg.competition=; Path=/; Max-Age=0';
    const { container } = show([live]);
    expect(container.querySelector('.mg-strip-bar')).toBeNull();
    const second = show([]);
    expect(second.container.querySelector('.mg-strip-bar')).toBeNull();
  });

  it('links a session line to that session', () => {
    show([{ key: 'next-1', kind: 'next', text: 'Next 10:35: Seniors Session 2', sessionId: 7 }, live]);
    expect(screen.getByRole('link', { name: 'Open this session' })).toHaveAttribute('href', '/competitions/1/session/7');
  });

  it('links late and on time lines to the timetable', () => {
    show([{ key: 'late', kind: 'late', text: 'Running 10 min behind' }, live]);
    expect(screen.getByRole('link', { name: 'Open the timetable' })).toHaveAttribute('href', '/competitions/1');
  });

  it('shows the first line with its badge, linking to the live feed', () => {
    show([live, next]);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
    const link = screen.getByRole('link', { name: 'Open the live feed' });
    expect(link).toHaveAttribute('href', '/competitions/1/chat');
  });

  it.each<[TickerItem['kind'], string]>([
    ['next', 'Next'], ['late', 'Late'], ['ontime', 'On time'], ['break', 'Break'], ['finals', 'Finals'], ['result', 'Result'], ['announcement', 'Notice'],
  ])('badges a %s line as "%s"', (kind, label) => {
    show([{ key: 'k', kind, text: 'Some text' }]);
    expect(strip()).toBe(`${label}Some text`);
  });

  it('gives a final that is on now the live badge and drops the "Now:" prefix', () => {
    show([{ key: 'f', kind: 'finals', text: 'Now: Seniors Finals · Final A' }]);
    expect(strip()).toBe('LiveSeniors Finals · Final A');
  });

  it('keeps the text of a final that is coming up', () => {
    show([{ key: 'f', kind: 'finals', text: 'Next 11:00: Seniors Finals' }]);
    expect(strip()).toBe('FinalsNext 11:00: Seniors Finals');
  });

  it('shows plain information without a badge', () => {
    show([info]);
    expect(strip()).toBe('Spring Games');
  });

  it('lists every line for screen readers, naming results and announcements', () => {
    show([live, { key: 'r', kind: 'result', text: 'Ashdown won Bending' }, notice]);
    const list = screen.getByRole('list', { name: 'Event updates' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Now: Seniors Session 1 · Heat 1', 'Result: Ashdown won Bending', 'Announcement: Lunch moved to 1pm',
    ]);
  });
});

describe('TopBarTicker: rotating', () => {
  it('moves to the next line every few seconds and wraps round', async () => {
    show([live, next]);
    await tick(4499);
    expect(strip()).toContain('Heat 1');
    await tick(1);
    expect(strip()).toBe('NextNext 10:30: Seniors Session 1 · Heat 2');
    await tick(4500);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
  });

  it('stays put with a single line, and has no list button', async () => {
    show([live]);
    await tick(20_000);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
    expect(screen.queryByRole('button', { name: /All updates/ })).not.toBeInTheDocument();
  });

  it('does not rotate by itself when the visitor prefers reduced motion', async () => {
    stubMotion(true);
    show([live, next]);
    await tick(20_000);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
  });

  it('starts or stops rotating when the motion preference changes', async () => {
    const listeners = stubMotion(false);
    const { unmount } = show([live, next]);
    expect(listeners.size).toBe(1);
    await tick(4500);
    expect(strip()).toContain('Heat 2');
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('tells the browser about the preference listener only when it supports it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(() => show([live, next])).not.toThrow();
  });

  it('pushes the line before up and out as the next one slides in', async () => {
    show([live, next]);
    expect(leaving()).toBeNull();
    expect(document.querySelector('.ticker-in')).toBeNull();
    await tick(4500);
    expect(leaving()).toBe('LiveSeniors Session 1 · Heat 1');
    expect(document.querySelector('.ticker-in')).toHaveTextContent('Heat 2');
  });

  it('just swaps the line, with nothing sliding, when the visitor prefers reduced motion', async () => {
    stubMotion(true);
    const { rerender } = show([live, next]);
    rerender(<Page items={[notice, live, next]} />);
    expect(strip()).toBe('NoticeLunch moved to 1pm');
    expect(leaving()).toBeNull();
  });

  it('jumps to a new announcement when it arrives, without a flash, and holds it for 10 seconds, otherwise keeps its place', async () => {
    const { rerender, container } = show([live, next]);
    await tick(4500);
    expect(strip()).toContain('Heat 2');
    rerender(<Page items={[live, next, { ...info }]} />);
    expect(strip()).toContain('Heat 2');
    rerender(<Page items={[notice, live, next]} />);
    expect(strip()).toBe('NoticeLunch moved to 1pm');
    expect(container.querySelector('.mg-strip-flash')).toBeNull();
    await tick(4500);
    expect(strip()).toBe('NoticeLunch moved to 1pm');
    await tick(5500);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
  });

  it('goes back to the first line when the one being shown disappears', async () => {
    const { rerender } = show([live, next]);
    await tick(4500);
    rerender(<Page items={[live]} />);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
  });
});

describe('TopBarTicker: the full list', () => {
  const toggle = () => screen.getByRole('button', { name: 'All updates (3)' });
  const open = () => { fireEvent.click(toggle()); };

  it('opens a panel listing every line, with a badge for each (Info for plain lines)', () => {
    show([live, info, notice]);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    open();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'LiveSeniors Session 1 · Heat 1', 'InfoSpring Games', 'NoticeLunch moved to 1pm',
    ]);
    expect(within(panel).getByRole('link', { name: 'Open the live feed' })).toHaveAttribute('href', '/competitions/1/chat');
  });

  it('stops rotating while the panel is open', async () => {
    show([live, info, notice]);
    open();
    await tick(20_000);
    expect(strip()).toBe('LiveSeniors Session 1 · Heat 1');
  });

  it('closes again from the same button', () => {
    show([live, info, notice]);
    open();
    open();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape', () => {
    show([live, info, notice]);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores other keys', () => {
    show([live, info, notice]);
    open();
    fireEvent.keyDown(document, { key: 'a' });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes when the visitor taps elsewhere, but not inside the ticker', () => {
    show([live, info, notice]);
    open();
    fireEvent.pointerDown(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the visitor moves to another page', () => {
    show([live, info, notice]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go /competitions/1/chat' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when a line in the panel is chosen', () => {
    show([live, info, notice]);
    open();
    const panel = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    fireEvent.click(within(panel).getAllByRole('link')[0]);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when "Open the live feed" in the panel is chosen', () => {
    show([live, info, notice]);
    open();
    const panel = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    fireEvent.click(within(panel).getByRole('link', { name: 'Open the live feed' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

it('keeps a red Watch shortcut between the rotating text and arrow, including with no ticker items', async () => {
  const { rerender } = render(<Page items={[live, next]} watch={1} />);
  const watch = screen.getByRole('link', { name: 'Watch the live video' });
  expect(watch).toHaveAttribute('href', '/competitions/1/chat');
  expect(watch).toHaveClass('mg-badge-live');
  expect(watch.previousElementSibling).toHaveAttribute('aria-label', 'Open the live feed');
  expect(watch.nextElementSibling).toHaveAttribute('aria-label', 'All updates (2)');
  await tick(4500); expect(screen.getByRole('link', { name: 'Watch the live video' })).toBeVisible();
  rerender(<Page items={[]} watch={1} />); expect(strip()).toBe('Live video');
  expect(screen.getByRole('link', { name: 'Watch the live video' })).toBeVisible();
  rerender(<Page items={[info]} watch={2} />); expect(screen.queryByRole('link', { name: 'Watch the live video' })).toBeNull();
  rerender(<Page items={[]} watch={null} />); expect(document.querySelector('.mg-strip-bar')).toBeNull();
});

describe('TopBarTicker: the page button beside the dock', () => {
  const action = (count: number, onClick = vi.fn()): DockAction => ({ label: 'Day, arena and age group', count, onClick });

  it('sits beside the ticker and calls the page, closing the list first', () => {
    const onClick = vi.fn();
    render(<Page items={[live, info, notice]} action={action(0, onClick)} />);
    fireEvent.click(screen.getByRole('button', { name: 'All updates (3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Day, arena and age group' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'All updates (3)' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.mg-dock-count')).toBeNull();
  });

  it('shows how many filters are set', () => {
    render(<Page items={[live]} action={action(2)} />);
    expect(screen.getByRole('button', { name: 'Day, arena and age group, 2 set' })).toBeVisible();
    expect(document.querySelector('.mg-dock-count')).toHaveTextContent('2');
  });

  it('still shows on its own when there is no news', () => {
    render(<Page items={[]} action={action(0)} />);
    expect(document.querySelector('.mg-strip-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Day, arena and age group' })).toBeVisible();
  });
});
