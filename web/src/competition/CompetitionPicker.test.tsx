import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSavedCopy, savedCopyKeys, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { CompetitionPicker, LiveText } from './CompetitionPicker';
import { CurrentCompetitionProvider, useCurrentCompetition } from './CurrentCompetitionContext';
import { canCachePublicApi } from '../offline/cachePolicy';
const authState = vi.hoisted(() => ({ user: { id: 'example-member' } as { id: string } | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));

// Two kinds of answer: the public list (`get`, as before) and the list put in order for this viewer (`nearYou`).
// By default the personal list is unavailable, so the public one is used.
const mocks = vi.hoisted(() => ({ publicList: vi.fn(), nearYou: vi.fn() }));
vi.mock('../api', () => ({
  api: { get: (url: string, config?: unknown) => (url.endsWith('/near-you') ? mocks.nearYou(url, config) : mocks.publicList(url, config)) },
}));
const get = mocks.publicList;
const nearYou = mocks.nearYou;

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
/** Opens the archive filter sheet (if it is not open) and picks a year or place in it. */
async function choose(group: RegExp, option: string) {
  if (!screen.queryByRole('dialog')) await userEvent.click(screen.getByRole('button', { name: /Archive filters/ }));
  await userEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name: option }));
}

beforeEach(() => {
  authState.user = { id: 'example-member' };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 17, 12, 0));
  nearYou.mockRejectedValue(new Error('no personal list'));
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

  it('starts loading a competition when it is pointed at or pressed, once each', async () => {
    renderPicker();
    await loaded('Autumn Open');
    const row = within(screen.getByRole('region', { name: 'Coming up' })).getAllByRole('button')[0];
    fireEvent.mouseEnter(row);
    fireEvent.pointerDown(row);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open competition: Today Cup' }));
    const warmed = get.mock.calls.map(([url]) => url).filter((url) => /^\/competitions\/\d+$/.test(String(url)));
    expect(warmed).toEqual([`/competitions/${autumn.id}`, `/competitions/${today.id}`]);
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
    expect(within(onToday).getByText('Heat 2 on now')).toHaveClass('cp-live-heat');
    expect(within(onToday).getByText('Seniors · Main arena')).toHaveClass('cp-live-place');
    expect(within(onToday).getByRole('button', { name: 'Open competition: Today Cup' })).toBeInTheDocument();
    const later = screen.getByRole('region', { name: 'Coming up' });
    expect(within(later).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(within(later).queryByText('Today Cup')).not.toBeInTheDocument();
  });

  it('describes a live competition’s heat on one line when there is no arena name or age group', async () => {
    reply(page([{ ...today, live: { heatLabel: 'Heat 1' }, ageGroupCount: 1, location: null }]));
    renderPicker();
    expect(await loaded('Heat 1 on now')).toBeInTheDocument();
    expect(document.querySelector('.cp-live-place')).toBeNull();
    expect(screen.getByText('Sat 17 – Sun 18 Oct')).toBeInTheDocument();
  });

  it('leaves out the live line and age group count when there is nothing to say', async () => {
    reply(page([{ ...today, live: null, ageGroupCount: 0, location: '  ' }]));
    renderPicker();
    await loaded('Today Cup');
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByText('Sat 17 – Sun 18 Oct')).toBeInTheDocument();
  });

  it('keeps each row to its date, name and icon: no venue or end date, with the full dates for screen readers', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByText(/Hillside/)).not.toBeInTheDocument();
    expect(screen.getByText('Sat 14 – Sun 15 Nov')).toHaveClass('sr-only');
    expect(screen.getByText('Sat 7 Nov')).toHaveClass('sr-only');
  });

  it('shows every competition’s icon, the default chequered flag included, and uses a placeholder date when the start is unreadable', async () => {
    reply(page([festival, { ...autumn, startDate: 'whenever' }]));
    renderPicker();
    await loaded('Weekend Fest');
    const flag = screen.getByRole('img', { name: 'Ireland' });
    expect(flag).toHaveAttribute('title', 'Ireland');
    expect(flag.querySelector('img')).toHaveAttribute('src', '/flags/ie.png');
    expect(screen.getByRole('img', { name: 'Chequered flag' }).querySelector('svg[data-icon="flag"]')).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows past competitions with their year and no "On today" group', async () => {
    reply(page([today, autumn]));
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(get).toHaveBeenCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1 } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Past competitions' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'On today' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '2026' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Finished' })).not.toBeInTheDocument();
    expect(screen.getByText('Sat 7 Nov 2026')).toHaveClass('sr-only');
    expect(screen.queryByRole('link', { name: /Back to upcoming competitions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Past competitions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Year|Location/ })).not.toBeInTheDocument();
  });

  it('groups the archive under a heading for each year', async () => {
    reply(page([autumn, { ...festival, startDate: '2025-11-14T09:00:00', endDate: null }]));
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['20261 competition', '20251 competition']);
  });

  it('counts the competitions under each year, but not in the last year while more pages are still to come', async () => {
    reply(page([autumn, { ...festival, startDate: '2026-11-14T09:00:00' }, { ...today, id: 4, startDate: '2025-11-14T09:00:00', endDate: null }], true));
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['20262 competitions', '2025']);
  });

  it('shows a plain "Past competitions" link at the bottom of the list, not a bar, and no Upcoming/Past switch', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByRole('link', { name: 'Upcoming' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Past' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Back to upcoming competitions/ })).not.toBeInTheDocument();
    const seePast = screen.getByRole('link', { name: 'Past competitions' });
    expect(seePast).toHaveAttribute('href', '/competitions/past');
    expect(seePast).toHaveClass('sp-link');
    expect(seePast).not.toHaveClass('mg-btn');
    expect(screen.getByRole('button', { name: /Weekend Fest/ }).compareDocumentPosition(seePast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('goes to the past list from the link, and back from there', async () => {
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('link', { name: 'Past competitions' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/past');
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
  it('remembers the choice and opens its timetable', async () => {
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: /Autumn Open/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/2|Autumn Open');
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
});

describe('CompetitionPicker: several events on today', () => {
  const second: CompetitionPickerItem = {
    id: 4, name: 'Ring Two Classic', startDate: '2026-10-17T09:00:00', endDate: '2026-10-17T17:00:00', icon: 'ie',
    location: 'Elsewhere', live: { sectionName: 'Teams Juniors', heatLabel: 'Heat 4', arenaName: 'Ring 2' },
  };
  const quiet: CompetitionPickerItem = { id: 5, name: 'Quiet Meet', startDate: '2026-10-17T09:00:00', endDate: '2026-10-17T17:00:00', icon: 'flag', location: 'Lowfield', live: null };
  const rowFor = (name: string) => screen.getByRole('button', { name: `Open competition: ${name}` });

  it('keeps one event on today as the big card, with no compact rows', async () => {
    renderPicker();
    await loaded('Autumn Open');
    const onToday = screen.getByRole('region', { name: 'On today' });
    expect(onToday.querySelector('.cp-now')).not.toBeNull();
    expect(onToday.querySelector('.cp-live-row')).toBeNull();
    expect(within(onToday).getByText('LIVE')).toBeInTheDocument();
  });

  it('gives each live event a compact row: its name and one line, age group then heat, with a red dot and no visible LIVE word', async () => {
    reply(page([today, second, autumn]));
    renderPicker();
    await loaded('Autumn Open');
    const onToday = screen.getByRole('region', { name: 'On today' });
    expect(onToday.querySelector('.cp-now')).toBeNull();
    expect(onToday.querySelectorAll('.cp-live-row')).toHaveLength(2);
    for (const [name, line] of [['Today Cup', 'Seniors · Heat 2'], ['Ring Two Classic', 'Juniors · Heat 4']] as const) {
      const row = rowFor(name);
      expect(within(row).getByText(name)).toBeInTheDocument();
      // One line only: no venue, no dates, no arena, no "on now".
      expect(row.querySelector('.cp-live-line')).toHaveTextContent(new RegExp(`^${line}$`));
      expect(row.querySelectorAll('.cp-live-heat')).toHaveLength(1);
      expect(row.querySelector('.cp-live-place')).toBeNull();
      expect(row).not.toHaveTextContent(/Ashdown|Elsewhere|Main arena|Ring 2|Sat 17|Oct|on now/);
      // The live state is a still red dot plus words for screen readers only.
      expect(row.querySelector('.cp-live-dot')).toHaveAttribute('aria-hidden', 'true');
      expect(within(row).getByText(/LIVE/)).toHaveClass('sr-only');
      expect(row.querySelector('.mg-badge-live')).toBeNull();
      expect(row).toHaveAccessibleDescription(new RegExp(`LIVE:.*${line}`));
    }
  });

  it('shows a quiet event on today with its place and dates and the words On today, not a red dot', async () => {
    reply(page([today, quiet]));
    renderPicker();
    await loaded('Quiet Meet');
    const row = rowFor('Quiet Meet');
    expect(row).toHaveTextContent('Lowfield · Sat 17 Oct');
    expect(row.querySelector('.cp-live-dot')).toBeNull();
    expect(row.querySelector('.cp-live-mark-quiet')).toHaveTextContent('On today');
    expect(row.querySelector('.cp-live-line')).toBeNull();
    expect(rowFor('Today Cup').querySelector('.cp-live-dot')).not.toBeNull();
  });

  it('falls back to what is known when a live row has no heat or no age group yet, never leaving a stray separator', async () => {
    reply(page([
      { ...today, live: { sectionName: 'Teams Seniors', heatLabel: '' } },
      { ...second, live: { heatLabel: 'Heat 4' } },
      { ...quiet, id: 6, name: 'Bare Live', live: { heatLabel: '' } },
    ]));
    renderPicker();
    await loaded('Bare Live');
    expect(rowFor('Today Cup').querySelector('.cp-live-line')).toHaveTextContent(/^Seniors$/);
    expect(rowFor('Ring Two Classic').querySelector('.cp-live-line')).toHaveTextContent(/^Heat 4$/);
    const bare = rowFor('Bare Live');
    expect(bare.querySelector('.cp-live-line')).toHaveTextContent(/^$/);
    // Still marked live for everyone.
    expect(bare.querySelector('.cp-live-dot')).not.toBeNull();
    for (const name of ['Today Cup', 'Ring Two Classic', 'Bare Live']) expect(rowFor(name).textContent).not.toMatch(/·\s*$|^\s*·|·\s*·/);
  });

  it('opens a live row exactly as the big card does: remembers it and goes to its page, marking it current', async () => {
    reply(page([today, second]));
    renderPicker();
    await loaded('Ring Two Classic');
    expect(rowFor('Ring Two Classic')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(rowFor('Ring Two Classic'));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/4|Ring Two Classic');
    expect(rowFor('Ring Two Classic')).toHaveAttribute('aria-pressed', 'true');
    expect(rowFor('Ring Two Classic')).toHaveClass('cp-row-current');
    expect(rowFor('Today Cup')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(rowFor('Today Cup'));
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/1|Today Cup');
  });

  it('starts loading a live row’s competition when it is pointed at or pressed, once', async () => {
    reply(page([today, second]));
    renderPicker();
    await loaded('Ring Two Classic');
    fireEvent.mouseEnter(rowFor('Ring Two Classic'));
    fireEvent.pointerDown(rowFor('Ring Two Classic'));
    fireEvent.pointerDown(rowFor('Today Cup'));
    const warmed = get.mock.calls.map(([url]) => url).filter((url) => /^\/competitions\/\d+$/.test(String(url)));
    expect(warmed).toEqual(['/competitions/4', '/competitions/1']);
  });
});

describe('CompetitionPicker: no forget button', () => {
  const remember = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 2, name: 'Autumn Open' }))}; Path=/`; };

  it('leaves "Forget this competition" to Settings, on the upcoming list and on the past one', async () => {
    remember();
    const { unmount } = renderPicker();
    await loaded('Weekend Fest');
    expect(screen.queryByRole('button', { name: /Forget this competition/ })).not.toBeInTheDocument();
    unmount();
    renderPicker({ past: true });
    await loaded('Weekend Fest');
    expect(screen.queryByRole('button', { name: /Forget this competition/ })).not.toBeInTheDocument();
  });
});

describe('CompetitionPicker: search and tags', () => {
  it('has no search bar on the upcoming list, and keeps it on the past one', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive filters/ })).not.toBeInTheDocument();
  });

  it('says nothing about entries or demo events in the list', async () => {
    reply(page([{ ...autumn, entriesOpen: true }, { ...festival, isDemo: true }, { ...today, entriesOpen: true, isDemo: true }]));
    renderPicker();
    await loaded('Autumn Open');
    const later = screen.getByRole('region', { name: 'Coming up' });
    expect(later).not.toHaveTextContent(/Entries open|Demo event/);
    expect(screen.getByRole('region', { name: 'On today' })).not.toHaveTextContent(/Entries open|Demo event/);
  });

  it('filters the full archive on the server, resetting pagination and showing complete facets', async () => {
    const older: CompetitionPickerItem = { id: 9, name: 'Summer Classic', startDate: '2025-07-10T09:00:00', endDate: null, icon: 'gb', location: 'York' };
    get.mockImplementation(async (url, config) => {
      const params = config?.params as { year?: number; location?: string; page?: number; search?: string };
      const items = url.endsWith('/mine') || params?.year === 2025 || params?.search === 'Summer' ? [older] : [autumn];
      return { data: { items, hasMore: !params.year && !params.search && !url.endsWith('/mine'), years: [2026, 2025], locations: ['Hillside', 'York'] }, headers: {} };
    });
    renderPicker({ past: true });
    await loaded('Autumn Open');
    expect(screen.queryByText('Summer Classic')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive filters' }));
    expect(within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button').map((option) => option.textContent)).toEqual(['All years', '2026', '2025']);
    await choose(/Year/, '2025');
    await loaded('Summer Classic');
    expect(screen.getByRole('button', { name: 'Archive filters, 1 set' })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Remove 2025' })).toBeInTheDocument();
    await choose(/Year/, 'All years');
    await loaded('Autumn Open');
    expect(screen.queryByRole('button', { name: 'Remove 2025' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 2 } })));
    await choose(/Year/, '2025');
    await loaded('Summer Classic');
    expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1, year: 2025 } }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toContain('20251 competition');
    expect(screen.queryByText('Autumn Open')).not.toBeInTheDocument();
    await choose(/Location/, 'York');
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1, year: 2025, location: 'York' } })));
    expect(screen.getByRole('button', { name: 'Archive filters, 2 set' })).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.type(screen.getByRole('searchbox'), 'Summer');
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1, year: 2025, location: 'York', search: 'Summer' } })));
    await userEvent.click(screen.getByRole('button', { name: 'Remove York' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/competitions/picker', expect.objectContaining({ params: { past: true, page: 1, year: 2025, search: 'Summer' } })));
  });

  it('keeps Mine out of offline storage and clears it on sign-out', async () => {
    const mine = { ...autumn, id: 88, name: 'Example member event' };
    get.mockImplementation(async (url) => ({ data: page(url.endsWith('/mine') ? [mine] : [autumn]), headers: {} }));
    const { rerender } = renderPicker({ past: true });
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Archive filters' }));
    await userEvent.click(screen.getByRole('switch', { name: 'My club / competitions I rode in' }));
    await loaded('Example member event');
    expect(screen.getByRole('button', { name: 'Remove My club / competitions I rode in' })).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/competitions/picker/mine', expect.objectContaining({ params: { past: true, page: 1 } }));
    expect(readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(true))?.data.items).toEqual([autumn]);
    expect(canCachePublicApi('/api/competitions/picker/mine')).toBe(false);
    authState.user = null;
    get.mockReturnValue(new Promise(() => {}));
    rerender(<MemoryRouter><CurrentCompetitionProvider><CompetitionPicker past /></CurrentCompetitionProvider></MemoryRouter>);
    expect(screen.queryByText('Example member event')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive filters' }));
    expect(screen.getByRole('switch', { name: 'My club / competitions I rode in' })).toBeDisabled();
    expect(screen.getByText('Sign in to see your club’s competitions.')).toBeInTheDocument();
  });

  it('does not show or save another filter’s page when a filtered request fails', async () => {
    reply({ ...page([autumn]), years: [2026, 2025], locations: ['Hillside'] });
    renderPicker({ past: true }); await loaded('Autumn Open');
    get.mockRejectedValue(new Error('offline'));
    await choose(/Year/, '2025');
    await screen.findByRole('alert');
    expect(screen.queryByText('Autumn Open')).not.toBeInTheDocument();
    expect(readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(true))?.data.items).toEqual([autumn]);
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

  it('keeps the list, and says nothing about checking for changes, while the next page loads', async () => {
    get.mockResolvedValueOnce({ data: page([autumn], true), headers: {} } as never).mockReturnValueOnce(new Promise(() => {}));
    renderPicker();
    await loaded('Autumn Open');
    await userEvent.click(screen.getByRole('button', { name: 'Load more competitions' }));
    expect(screen.queryByText('Checking for changes…')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the competitions');
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
    const view = renderPicker();
    await act(async () => {}); // the personal list is tried first and gives up; then the public list is asked for
    view.unmount();
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

  it('shows last time’s list straight away, with no "checking" line, while it checks for changes', async () => {
    writeSavedCopy(savedCopyKeys.picker(false), page([festival]), savedAt(60));
    get.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByText('Weekend Fest')).toBeInTheDocument();
    expect(screen.queryByText('Checking for changes…')).not.toBeInTheDocument();
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

describe('CompetitionPicker: demo events', () => {
  it('shows no demo label on a card or a row', async () => {
    reply(page([{ ...today, isDemo: true }, { ...autumn, isDemo: true }, festival]));
    renderPicker();
    await loaded('Autumn Open');
    expect(screen.queryByText('Demo event')).not.toBeInTheDocument();
  });
});

describe('CompetitionPicker: date order and flags', () => {
  it('lists upcoming events soonest first from the public list, with no order switch', async () => {
    renderPicker();
    await loaded('Autumn Open');
    expect(nearYou).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 1 }, signal: expect.any(AbortSignal) });
    expect(screen.queryByRole('button', { name: /Nearest first|Soonest first/ })).not.toBeInTheDocument();
  });

  it('puts each flag in its own column, so flags line up whatever the name', async () => {
    renderPicker();
    const row = (await loaded('Weekend Fest')).closest('button') as HTMLElement;
    const flag = within(row).getByRole('img');
    expect(flag.parentElement?.parentElement).toBe(row);
    expect(row).toHaveClass('cp-row');
    expect(row.querySelector('.cp-icon')).toContainElement(flag);
  });
});

describe('LiveText', () => {
  it('crossfades a changed live line: the old words fade out, hidden from screen readers, then go', async () => {
    const { container, rerender } = render(<LiveText heat="Heat 1 on now" place="Under 12 · Main Arena" />);
    expect(container.querySelector('.cp-swap-out')).toBeNull();
    expect(container.querySelector('.cp-swap-in')).toBeNull();
    rerender(<LiveText heat="Heat 2 on now" place="Under 12 · Main Arena" />);
    const old = container.querySelector('.cp-swap-out') as HTMLElement;
    expect(old).toHaveTextContent('Heat 1');
    expect(old).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.cp-swap-in')).toHaveTextContent('Heat 2');
    await waitFor(() => expect(container.querySelector('.cp-swap-out')).toBeNull());
    expect(container).toHaveTextContent(/^Heat 2 on nowUnder 12 · Main Arena$/);
  });
});
