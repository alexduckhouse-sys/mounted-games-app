import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { readSavedCopy, savedCopyKeys, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { CompetitionPicker, CompetitionPickerDialog } from './CompetitionPicker';
import { CurrentCompetitionProvider, useCurrentCompetition } from './CurrentCompetitionContext';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const get = vi.mocked(api.get);

const today: CompetitionPickerItem = {
  id: 1, name: 'Today Cup', startDate: '2026-10-17T09:00:00', endDate: '2026-10-18T17:00:00', icon: 'gb',
  location: 'Ashdown', ageGroupCount: 3, live: { sectionName: 'Teams Seniors', heatLabel: 'Heat 2', arenaName: 'Main arena' },
};
const autumn: CompetitionPickerItem = { id: 2, name: 'Autumn Open', startDate: '2026-11-07T09:00:00', endDate: null, icon: 'flag', location: ' Hillside ' };
const festival: CompetitionPickerItem = { id: 3, name: 'Weekend Fest', startDate: '2026-11-14T09:00:00', endDate: '2026-11-15T17:00:00', icon: 'ie' };
const page = (items: CompetitionPickerItem[], hasMore = false): CompetitionPickerPage => ({ items, hasMore });
const reply = (data: CompetitionPickerPage, headers: Record<string, unknown> = {}) => get.mockResolvedValue({ data, headers } as never);

function Probe() {
  const { pathname } = useLocation();
  const { current } = useCurrentCompetition();
  return <span data-testid="probe">{pathname}|{current?.name ?? 'none'}</span>;
}
function renderPicker(props: Parameters<typeof CompetitionPicker>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={['/competitions']}>
      <CurrentCompetitionProvider><CompetitionPicker {...props} /><Probe /></CurrentCompetitionProvider>
    </MemoryRouter>,
  );
}
const loaded = (name: string | RegExp) => screen.findByText(name);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 17, 12, 0));
  reply(page([today, autumn, festival]));
});
afterEach(() => { vi.useRealTimers(); });

describe('CompetitionPicker: the list', () => {
  it('asks for the first page of upcoming competitions', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 1 }, signal: expect.any(AbortSignal) });
    expect(screen.getByRole('heading', { level: 1, name: 'Competitions' })).toBeInTheDocument();
  });

  it('shows a placeholder while the first load is under way', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByRole('status')).toHaveTextContent('Loading competitions…');
  });

  it('puts what is on today first, then what is coming up', async () => {
    renderPicker();
    await loaded('Autumn Open');
    const onToday = screen.getByRole('region', { name: 'On today' });
    expect(within(onToday).getByText('Today Cup')).toBeInTheDocument();
    expect(within(onToday).getByText('Ashdown · Sat 17 – Sun 18 Oct')).toBeInTheDocument();
    expect(within(onToday).getByText('LIVE')).toBeInTheDocument();
    expect(within(onToday).getByText('Senior Teams · Heat 2 on now in Main arena')).toBeInTheDocument();
    expect(within(onToday).getByRole('button', { name: 'Open competition: Today Cup' })).toBeInTheDocument();
    const later = screen.getByRole('region', { name: 'Coming up' });
    expect(within(later).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(within(later).queryByText('Today Cup')).not.toBeInTheDocument();
  });

  it('describes a live competition’s heat without an arena name or age group', async () => {
    reply(page([{ ...today, live: { heatLabel: 'Heat 1' }, ageGroupCount: 1, location: null }]));
    renderPicker();
    expect(await loaded('Heat 1 on now in the arena')).toBeInTheDocument();
    expect(screen.getByText('Sat 17 – Sun 18 Oct')).toBeInTheDocument();
  });

  it('leaves out the live line and age group count when there is nothing to say', async () => {
    reply(page([{ ...today, live: null, ageGroupCount: 0, location: '  ' }]));
    renderPicker();
    await loaded('Today Cup');
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByText('Sat 17 – Sun 18 Oct')).toBeInTheDocument();
  });

  it('shows a one-day competition with its venue, and a multi-day one with its dates', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByText('Hillside')).toBeInTheDocument();
    expect(screen.getByText('Sat 14 – Sun 15 Nov')).toBeInTheDocument();
  });

  it('shows the date for a one-day competition that has no venue', async () => {
    reply(page([{ ...autumn, location: null }]));
    renderPicker();
    expect(await loaded('Sat 7 Nov')).toBeInTheDocument();
  });

  it('shows the flag for country competitions, nothing for the default icon, and uses a placeholder date when the start is unreadable', async () => {
    reply(page([festival, { ...autumn, startDate: 'whenever' }]));
    renderPicker();
    await loaded('Weekend Fest');
    const flag = screen.getByRole('img', { name: 'Ireland' });
    expect(flag).toHaveAttribute('title', 'Ireland');
    expect(flag.querySelector('img')).toHaveAttribute('src', '/flags/ie.png');
    expect(screen.queryByRole('img', { name: 'Chequered flag' })).not.toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows past competitions with their year and no "On today" group', async () => {
    reply(page([today, autumn]));
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(get).toHaveBeenCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1 } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Past competitions' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'On today' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Finished' })).toBeInTheDocument();
    expect(screen.getByText('Sat 7 Nov 2026 · Hillside')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upcoming' })).toHaveAttribute('href', '/competitions');
    expect(screen.getByRole('link', { name: 'Past' })).toHaveAttribute('aria-current', 'page');
  });

  it('links upcoming competitions to the past ones', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('link', { name: 'Past' })).toHaveAttribute('href', '/competitions/past');
    expect(screen.getByRole('link', { name: 'Upcoming' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    [false, 'No competitions available yet.'],
    [true, 'No past competitions yet.'],
  ])('says so when there are none (past: %s)', async (past, message) => {
    reply(page([]));
    renderPicker({ past });
    expect(await loaded(message)).toBeInTheDocument();
  });
});

describe('CompetitionPicker: choosing', () => {
  it('remembers the choice, opens its timetable and closes the picker', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: /Autumn Open/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/2|Autumn Open');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('works without a close handler', async () => {
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: /Weekend Fest/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/3|Weekend Fest');
  });

  it('marks the current competition', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('button', { name: /Open competition: Today Cup/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: /Open competition: Today Cup/ }));
    expect(screen.getByRole('button', { name: /Open competition: Today Cup/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Autumn Open/ }));
    expect(screen.getByRole('button', { name: /Autumn Open.*current competition/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes from its close button, and from the links', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Close competition picker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('link', { name: 'Past' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('has no close button when it is a page', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByRole('button', { name: 'Close competition picker' })).not.toBeInTheDocument();
  });
});

describe('CompetitionPicker: search and tags', () => {
  it('finds a competition by name or by venue, and says so when nothing matches', async () => {
    renderPicker();
    await loaded('Autumn Open');
    const box = screen.getByRole('searchbox', { name: 'Search competitions' });
    expect(box).toHaveAttribute('placeholder', 'Name or venue');
    await userEvent.type(box, 'hillside');
    expect(screen.getByText('Autumn Open')).toBeInTheDocument();
    expect(screen.queryByText('Weekend Fest')).not.toBeInTheDocument();
    expect(screen.queryByText('Today Cup')).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'weekend');
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzz');
    expect(screen.getByText('No competitions match that search.')).toBeInTheDocument();
  });

  it('offers to load more when a search finds nothing and there are more pages', async () => {
    reply(page([autumn], true));
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/Load more to search further back/)).toBeInTheDocument();
  });

  it('tags a competition taking entries and a demo event', async () => {
    reply(page([{ ...autumn, entriesOpen: true }, { ...festival, isDemo: true }, { ...today, entriesOpen: true, isDemo: true }]));
    renderPicker();
    await loaded('Autumn Open');
    const later = screen.getByRole('region', { name: 'Coming up' });
    expect(within(later).getByRole('button', { name: /Autumn Open/ })).toHaveTextContent('Entries open');
    expect(within(later).getByRole('button', { name: /Weekend Fest/ })).toHaveTextContent('Demo event');
    expect(within(later).getByRole('button', { name: /Weekend Fest/ })).not.toHaveTextContent('Entries open');
    const onToday = screen.getByRole('region', { name: 'On today' });
    expect(onToday).toHaveTextContent('Entries open');
    expect(onToday).toHaveTextContent('Demo event');
  });
});

describe('CompetitionPicker: more pages', () => {
  it('loads the next page and adds it, skipping any competition already listed', async () => {
    get.mockResolvedValueOnce({ data: page([today, autumn], true), headers: {} } as never)
      .mockResolvedValueOnce({ data: page([autumn, festival], false), headers: {} } as never);
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    await loaded('Weekend Fest');
    expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: false, page: 2 } }));
    expect(screen.getAllByText('Autumn Open')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more competitions' })).not.toBeInTheDocument();
  });

  it('keeps the list and shows "Checking for changes…" while the next page loads', async () => {
    get.mockResolvedValueOnce({ data: page([autumn], true), headers: {} } as never).mockReturnValueOnce(new Promise(() => {}));
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    expect(screen.getByText('Checking for changes…')).toBeInTheDocument();
    expect(screen.getByText('Autumn Open')).toBeInTheDocument();
  });

  it('keeps the old-copy notice when a later page is also a saved copy', async () => {
    const fallback = { 'x-mg-saved-copy': '1', 'x-mg-saved-at': new Date(Date.now() - 45 * 60_000).toISOString() };
    get.mockResolvedValueOnce({ data: page([autumn], true), headers: fallback } as never)
      .mockResolvedValueOnce({ data: page([festival]), headers: {} } as never);
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('status')).toHaveTextContent('Last updated');
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    await loaded('Weekend Fest');
    expect(screen.getByRole('status')).toHaveTextContent('Last updated');
  });
});

describe('CompetitionPicker: problems', () => {
  it('offers to try again when loading fails', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderPicker();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load competitions. Check your connection and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded('Autumn Open');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries by itself when the phone comes back online', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderPicker();
    await screen.findByRole('alert');
    act(() => { window.dispatchEvent(new Event('online')); });
    await loaded('Autumn Open');
  });

  it('does not show the empty message when loading failed', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderPicker();
    await screen.findByRole('alert');
    expect(screen.queryByText('No competitions available yet.')).not.toBeInTheDocument();
  });

  it('ignores an answer that arrives after the picker has closed', async () => {
    let finish!: (value: unknown) => void;
    get.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { unmount } = renderPicker();
    unmount();
    await act(async () => { finish({ data: page([autumn]), headers: {} }); });
    expect(readSavedCopy(savedCopyKeys.picker(false))).toBeNull();
    let fail!: (reason: unknown) => void;
    get.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    renderPicker().unmount();
    await act(async () => { fail(new Error('late')); });
  });
});

describe('CompetitionPicker: saved copies', () => {
  const savedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const swFallback = (minutesAgo: number | undefined) => ({ 'x-mg-saved-copy': '1', ...(minutesAgo === undefined ? {} : { 'x-mg-saved-at': savedAt(minutesAgo).toISOString() }) });

  it('keeps a copy of the first page for next time', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(false))?.data.items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('keeps past and upcoming copies apart', async () => {
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(readSavedCopy(savedCopyKeys.picker(true))).not.toBeNull();
    expect(readSavedCopy(savedCopyKeys.picker(false))).toBeNull();
  });

  it('does not save later pages', async () => {
    get.mockResolvedValueOnce({ data: page([autumn], true), headers: {} } as never)
      .mockResolvedValueOnce({ data: page([festival]), headers: {} } as never);
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    await loaded('Weekend Fest');
    expect(readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(false))?.data.items.map((i) => i.id)).toEqual([2]);
  });

  it('shows last time’s list straight away while it checks for changes', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(60));
    get.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
    expect(screen.getByText('Checking for changes…')).toBeInTheDocument();
    expect(screen.queryByText('Showing a saved list. It will refresh when your connection returns.')).not.toBeInTheDocument();
  });

  it('replaces the saved list with the fresh one, dropping competitions that have gone', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(60));
    reply(page([autumn]));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByText('Weekend Fest')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the saved list showing when it is still better than the phone’s offline copy', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(45));
    reply(page([autumn]), swFallback(90));
    renderPicker();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Last updated'));
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
    expect(screen.queryByText('Autumn Open')).not.toBeInTheDocument();
  });

  it('says nothing while the saved list is only a few minutes old, even offline', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(5));
    get.mockRejectedValue(new Error('offline'));
    renderPicker();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('says when the list is old and the refresh failed, with the time and a calm line', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(60));
    get.mockRejectedValue(new Error('offline'));
    renderPicker();
    expect(await screen.findByText('Last updated 11:00. We’ll refresh when you’re back online.')).toBeInTheDocument();
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
  });

  it('uses the offline copy when it is newer than the saved list', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(90));
    reply(page([autumn]), swFallback(40));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('status')).toHaveTextContent('Last updated 11:20.');
    expect(screen.queryByText('Weekend Fest')).not.toBeInTheDocument();
  });

  it('keeps the saved list when the offline copy has no readable time', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(60));
    reply(page([autumn]), swFallback(undefined));
    renderPicker();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Last updated'));
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
  });

  it('shows the offline copy, and does not save it as fresh, when there is no saved list', async () => {
    reply(page([autumn]), swFallback(45));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('status')).toHaveTextContent('Last updated');
    expect(readSavedCopy(savedCopyKeys.picker(false))).toBeNull();
  });

  it('says nothing for an offline copy that is only a few minutes old', async () => {
    reply(page([autumn]), swFallback(10));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('counts an offline copy with no readable time as old, because the refresh failed', async () => {
    reply(page([autumn]), swFallback(undefined));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.getByRole('status')).toHaveTextContent('Last updated earlier.');
  });
});

describe('CompetitionPickerDialog', () => {
  it('opens as a modal dialog around the picker', async () => {
    const onClose = vi.fn();
    render(<MemoryRouter><CurrentCompetitionProvider><CompetitionPickerDialog onClose={onClose} /></CurrentCompetitionProvider></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: 'Select a competition' });
    expect(dialog).toHaveAttribute('open');
    await within(dialog).findByText('Autumn Open');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close competition picker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the dialog is cancelled with Escape', async () => {
    const onClose = vi.fn();
    render(<MemoryRouter><CurrentCompetitionProvider><CompetitionPickerDialog onClose={onClose} /></CurrentCompetitionProvider></MemoryRouter>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await screen.findByText('Autumn Open');
  });

  it('closes the dialog element when it unmounts', async () => {
    const { unmount } = render(<MemoryRouter><CurrentCompetitionProvider><CompetitionPickerDialog onClose={vi.fn()} /></CurrentCompetitionProvider></MemoryRouter>);
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    await screen.findByText('Autumn Open');
    unmount();
    expect(close).toHaveBeenCalled();
  });
});

describe('CompetitionPicker: demo events', () => {
  it('badges a demo event on its card and its row, and leaves real events alone', async () => {
    reply(page([{ ...today, isDemo: true }, { ...autumn, isDemo: true }, festival]));
    renderPicker();
    await loaded('Autumn Open');

    expect(screen.getAllByText('Demo event')).toHaveLength(2);
    expect(within(screen.getByRole('button', { name: /Weekend Fest/ })).queryByText('Demo event')).not.toBeInTheDocument();
  });
});
