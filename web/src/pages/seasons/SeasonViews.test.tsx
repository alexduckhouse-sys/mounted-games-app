import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SeasonPage } from './SeasonPage';
import { TickerProvider, useDockHost, useTicker } from '../../components/TickerContext';
import { SeasonsPage } from './SeasonsPage';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import type { SeasonView } from './seasonViewTypes';
import { chooseOption } from '../../test/select';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const season: SeasonView = {
  id: 'example-season', title: 'Example Summer League', year: 2026, format: 2, ageGroup: 'Seniors',
  bestResultsToCount: 1, placePoints: [{ place: 1, points: 10 }, { place: 2, points: 8 }], canManage: false,
  rounds: [{ id: 'round-1', competitionId: 1, competitionName: 'Example Meadow Cup', competitionDate: '2026-06-01T00:00:00Z', competitionSectionId: 1, sectionName: 'Seniors', orderIndex: 1, isIncluded: true, publishedVersion: 1, publishedAt: '2026-06-01T17:00:00Z', publicationIsCurrent: true }],
};
const standings = { standings: [
  { rank: 1, teamProfileId: 'team-a', teamName: 'Example Blue', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 1, seasonPoints: 10, counted: true }] },
  { rank: 1, teamProfileId: 'team-b', teamName: 'Example Red', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 2, seasonPoints: 8, counted: false }] },
] };

function mount(canManage = false, path = '/seasons/example-season') {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.endsWith('/standings')) return { data: standings };
    if (url === '/competitions') return { data: [] };
    if (url.endsWith('/publication-preview')) return { data: {
      roundId: 'round-1', sourceFingerprint: 'preview-fingerprint', nextVersion: 2,
      rankingBasis: 'Section total points across all completed races',
      results: [{ teamProfileId: 'team-a', teamName: 'Example Blue', eventRank: 1, eventPoints: 42, seasonPoints: 10 }],
    } };
    return { data: { ...season, canManage } };
  });
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'example-organiser' }, canOrganise: () => true, hasRole: () => false, canEdit: () => true } as unknown as ReturnType<typeof useAuth>);
});

/** Stands in for the ticker dock: shows the page's one button and lets a test press it. */
function DockProbe() {
  const { dockAction } = useTicker();
  useDockHost();
  return dockAction ? <button type="button" data-testid="dock" data-count={dockAction.count} onClick={dockAction.onClick}>{dockAction.label}</button> : null;
}

describe('SeasonSettingsForm', () => {
  it('saves custom points and a best-results limit as they are changed, with no Save button', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SeasonSettingsForm value={season} onSave={save} />);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '12');
    await userEvent.clear(screen.getByLabelText('2nd'));
    await userEvent.type(screen.getByLabelText('2nd'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Add place' }));
    await userEvent.clear(screen.getByLabelText('3rd'));
    await userEvent.type(screen.getByLabelText('3rd'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Add place' }));
    await userEvent.clear(screen.getByLabelText('4th'));
    await userEvent.type(screen.getByLabelText('4th'), '0');
    await userEvent.clear(screen.getByLabelText('Best results to count'));
    await userEvent.type(screen.getByLabelText('Best results to count'), '3');
    await userEvent.tab();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ bestResultsToCount: 3, placePoints: [{ place: 1, points: 12 }, { place: 2, points: 9 }, { place: 3, points: 6 }, { place: 4, points: 0 }] })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
  it('saves a change by itself after a short pause, and says so quietly', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SeasonSettingsForm value={season} onSave={save} />);
    expect(screen.getByLabelText('1st')).toHaveValue('10');
    expect(screen.getByLabelText('Did not finish / eliminated')).toHaveAttribute('readonly');
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '11');
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ placePoints: [{ place: 1, points: 11 }, { place: 2, points: 8 }] }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
  it('holds back a change that is not valid yet, and says why', async () => {
    const save = vi.fn();
    render(<SeasonSettingsForm value={season} onSave={save} />);
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '5');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('no increase for a lower place');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(save).not.toHaveBeenCalled();
  });
  it('shows a failed save, keeps the entered settings and retries from the message', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<SeasonSettingsForm value={season} onSave={save} />);
    await userEvent.clear(screen.getByLabelText('Season name'));
    await userEvent.type(screen.getByLabelText('Season name'), 'Renamed league');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be saved');
    expect(screen.getByLabelText('Season name')).toHaveValue('Renamed league');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Renamed league' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('offers a retry when eligible competitions cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [
      { id: 10, name: 'Fake eligible event', startDate: '2035-05-01T00:00:00Z' },
    ] });
    render(<SeasonSettingsForm create onSave={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Competitions couldn’t be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: /Fake eligible event/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/seasons/available-competitions', expect.anything());
  });
  it('always offers Create and Cancel on the create form', async () => {
    const cancel = vi.fn();
    render(<SeasonSettingsForm create label="Create season" onSave={vi.fn()} onCancel={cancel} />);
    expect(screen.getByRole('button', { name: 'Create season' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
  });
});

describe('SeasonPage', () => {
  it('shows the republish warning only to people who can republish, and drops a matching age suffix from team names', async () => {
    const stale = { ...season, ageGroup: 'Under 14', rounds: [{ ...season.rounds[0], ageGroup: 'Under 14', publicationIsCurrent: false }] };
    const table = { standings: [{ ...standings.standings[0], teamName: 'Atherstone U14' }, { ...standings.standings[1], teamName: 'Dorset U12' }] };
    const load = (canManage: boolean) => vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? table : { ...stale, canManage } }));
    load(false);
    const view = render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Atherstone' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dorset U12' })).toBeInTheDocument();
    expect(screen.queryByText(/Republish to update the table/)).not.toBeInTheDocument();
    view.unmount();
    load(true);
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/Republish to update the table/)).toBeInTheDocument();
  });
  it('shows standings first with shared places, per-round columns, dropped scores crossed out and profile links, and no management controls', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Example Summer League' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('=1')).toHaveLength(2);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Position', 'Team', 'R1', 'Pts']);
    // The position column has no visible heading; screen readers still get one.
    expect(screen.getByText('Position')).toHaveClass('sr-only');
    const droppedScore = screen.getByText('8');
    expect(droppedScore).toHaveClass('sv-struck');
    expect(droppedScore).not.toHaveClass('line-through');
    expect(screen.getByText('Crossed-out scores are dropped rounds')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example Blue' })).toHaveAttribute('href', '/team-profiles/team-a');
    // The team's name is what each row shows: no club line, and no footnote under the table.
    expect(screen.queryByText('Example Club')).not.toBeInTheDocument();
    expect(screen.queryByText(/not an official ranking/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Best 1 of 1 round/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example Blue' })).toHaveClass('sv-team');
    // Age group and what to show are one row, "Seniors · Teams". With one choice each, it has nothing to open.
    // It is a plain heading, not a button that does nothing.
    expect(screen.queryByRole('button', { name: /Seniors/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Seniors/ })).toHaveTextContent('Seniors· Teams');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
  it('shows age-group division tabs when a season has rounds across multiple age groups and lets an admin manage without edit mode', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'admin-1' }, canOrganise: () => true, hasRole: (r: string) => r === 'Admin', canEdit: () => false } as unknown as ReturnType<typeof useAuth>);
    const multiSeason: SeasonView = {
      ...season,
      ageGroup: 'All age groups',
      canManage: true,
      rounds: [
        { ...season.rounds[0], id: 'round-1', sectionName: 'Seniors', ageGroup: 'Seniors', orderIndex: 1 },
        { ...season.rounds[0], id: 'round-2', sectionName: 'Under 12', ageGroup: 'Under 12', orderIndex: 2 },
      ],
    };
    const multiStandings = {
      standings: [
        { rank: 1, teamProfileId: 'team-a', teamName: 'Example Blue', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 1, seasonPoints: 10, counted: true }] },
        { rank: 1, teamProfileId: 'team-u12', teamName: 'Example Juniors', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-2', eventRank: 1, seasonPoints: 10, counted: true }] },
      ],
    };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.endsWith('/standings')) return { data: multiStandings };
      return { data: multiSeason };
    });
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Under 12' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All age groups, Teams/ })).toHaveTextContent('All age groups· Teams');
    await userEvent.click(screen.getByRole('button', { name: /^All age groups, Teams/ }));
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Age group' })).getByRole('button', { name: 'Under 12' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /^Under 12, Teams/ })).toHaveTextContent('Under 12· Teams');
    expect(screen.getByRole('link', { name: 'Example Juniors' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Example Blue' })).not.toBeInTheDocument();
  });
  it('separates pairs and team standings in the same age group', async () => {
    const mixed: SeasonView = { ...season, rounds: [
      { ...season.rounds[0], format: 2, ageGroup: 'Seniors' },
      { ...season.rounds[0], id: 'pairs', format: 1, ageGroup: 'Seniors', orderIndex: 2 },
    ] };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? { standings: [
      standings.standings[0],
      { rank: 1, teamProfileId: 'fake-rider', teamName: 'Fake Rider', clubName: 'Fake Club', totalPoints: 10, rounds: [{ roundId: 'pairs', eventRank: 1, seasonPoints: 10, counted: true }] },
    ] } : mixed }));
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Example Blue' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fake Rider' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Seniors, Teams/ }));
    expect(screen.queryByRole('group', { name: 'Age group' })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Pairs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /^Seniors, Pairs/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fake Rider' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Example Blue' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Rider' })).toBeInTheDocument();
  });
  it('lets an organiser select multiple competitions when creating a season', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { id: 10, name: 'Spring Qualifier', startDate: '2026-04-10T00:00:00Z' },
        { id: 20, name: 'Summer Nationals', startDate: '2026-07-15T00:00:00Z' },
      ],
    });
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SeasonSettingsForm create label="Create season" onSave={save} onCancel={vi.fn()} />);
    const comp1 = await screen.findByRole('switch', { name: /Spring Qualifier/ });
    const comp2 = screen.getByRole('switch', { name: /Summer Nationals/ });
    await userEvent.click(comp1);
    await userEvent.click(comp2);
    expect(comp1).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(screen.getByLabelText('Season name'), '2026 National League');
    await userEvent.click(screen.getByRole('button', { name: 'Create season' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      title: '2026 National League',
      competitionIds: [10, 20],
    }));
  });
  it('lists rounds with a status word and reveals published versions on request', async () => {
    mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Rounds' }));
    expect(screen.getByRole('link', { name: 'Rounds' })).toHaveAttribute('aria-current', 'page');
    const round = screen.getByRole('button', { name: /Round 1.*Example Meadow Cup/ });
    expect(within(round).getByText('Final')).toBeInTheDocument();
    await userEvent.click(round);
    expect(screen.getByText('Published versions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview publication' })).not.toBeInTheDocument();
  });
  it('lets an organiser remove a round after confirming, and keeps it when they cancel or the request fails', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    mount(true);
    await userEvent.click(await screen.findByRole('link', { name: 'Rounds' }));
    await userEvent.click(screen.getByRole('button', { name: /Round 1.*Example Meadow Cup/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from season' }));
    expect(await screen.findByText(/its published results are deleted/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();

    vi.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from season' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove round' }));
    expect(await screen.findByText('This round couldn’t be removed. Check your signal and try again.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove from season' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove round' }));
    await waitFor(() => expect(api.delete).toHaveBeenLastCalledWith('/seasons/example-season/rounds/round-1'));
  });
  it('does not offer round removal to people who cannot manage the season', async () => {
    mount(false);
    await userEvent.click(await screen.findByRole('link', { name: 'Rounds' }));
    await userEvent.click(screen.getByRole('button', { name: /Round 1.*Example Meadow Cup/ }));
    expect(screen.queryByRole('button', { name: 'Remove from season' })).not.toBeInTheDocument();
  });
  it('keeps the active tab in the URL and hides Settings from people who cannot edit', async () => {
    mount(false, '/seasons/example-season?tab=settings');
    await screen.findByRole('heading', { name: 'Example Summer League' });
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Place points')).not.toBeInTheDocument();
  });
  it('hands the season address to the team profile, so Back returns to that season', async () => {
    function ProfileProbe() { const location = useLocation(); return <p>Profile opened from {(location.state as { from?: string } | null)?.from}</p>; }
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? standings : season }));
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /><Route path="/team-profiles/:id" element={<ProfileProbe />} /></Routes></MemoryRouter>);
    await userEvent.click(await screen.findByRole('link', { name: 'Example Blue' }));
    expect(await screen.findByText('Profile opened from /seasons/example-season')).toBeInTheDocument();
  });
  it('fits ten rounds on a phone: one fixed narrow column each, smaller type, no scrolling', async () => {
    const rounds = Array.from({ length: 10 }, (_, index) => ({ ...season.rounds[0], id: `r${index + 1}`, orderIndex: index + 1, competitionName: `Example Cup ${index + 1}` }));
    const wide = { standings: [{ rank: 1, teamProfileId: 'team-a', teamName: 'Example Blue', clubName: 'Example Club', totalPoints: 85, rounds: rounds.map((round, index) => ({ roundId: round.id, eventRank: 1, seasonPoints: 10, counted: index !== 2 })) }] };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? wide : { ...season, rounds } }));
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    const table = (await screen.findByRole('table')) as HTMLTableElement;
    expect(table.closest('.rf-table-wrap')).toHaveClass('rf-table-fit');
    expect(table).toHaveClass('sv-rounds-many');
    const roundCols = [...table.querySelectorAll<HTMLElement>('colgroup col.sv-c-round')];
    expect(roundCols).toHaveLength(10);
    // Ten rounds share half the width; fewer get wider columns, up to a limit.
    expect(roundCols[0].style.width).toBe('5%');
    expect(screen.getAllByRole('columnheader')).toHaveLength(13);
    // The one dropped round is dimmed and slashed (not struck through) and explained under the table.
    expect(table.querySelectorAll('.sv-struck')).toHaveLength(1);
    expect(screen.getByText('Crossed-out scores are dropped rounds')).toBeInTheDocument();
  });
  it('leaves the dropped-rounds note off when nothing was dropped', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? { standings: [standings.standings[0]] } : season }));
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('table');
    expect(screen.queryByText('Crossed-out scores are dropped rounds')).not.toBeInTheDocument();
  });
  it('unfolds a round and keeps it on screen while it folds away', async () => {
    mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Rounds' }));
    const round = screen.getByRole('button', { name: /Round 1.*Example Meadow Cup/ });
    expect(round).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.sv-reveal')).toBeNull();
    await userEvent.click(round);
    expect(round).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.sv-reveal')).not.toBeNull();
    expect(round.querySelector('.rf-chev-down')).not.toBeNull();
    await userEvent.click(round);
    expect(round).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.sv-reveal-out')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('.sv-reveal')).toBeNull());
  });
  it('lets an organiser edit settings, which save as they go and keep the Settings tab open', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount(true);
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '12');
    await userEvent.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/seasons/example-season', expect.objectContaining({ placePoints: [{ place: 1, points: 12 }, { place: 2, points: 8 }] })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('1st')).toHaveValue('12');
  });
  it('puts Add a round by the ticker dock on the Rounds tab, and opens the form in a sheet', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.endsWith('/standings')) return { data: standings };
      if (url === '/competitions') return { data: [] };
      return { data: { ...season, canManage: true } };
    });
    const user = userEvent.setup();
    render(<TickerProvider><DockProbe /><MemoryRouter initialEntries={['/seasons/example-season?tab=rounds']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter></TickerProvider>);
    const dock = await screen.findByTestId('dock');
    expect(dock).toHaveTextContent('Add a round');
    await user.click(dock);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Add an event round');
  });
  it('has no dock button on Standings, or on Rounds for people who cannot manage the season', async () => {
    const mountDocked = (canManage: boolean, tab: string) => {
      vi.mocked(api.get).mockImplementation(async (url) => (url.endsWith('/standings') ? { data: standings } : { data: { ...season, canManage } }));
      return render(<TickerProvider><DockProbe /><MemoryRouter initialEntries={[`/seasons/example-season${tab}`]}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter></TickerProvider>);
    };
    const first = mountDocked(true, '');
    await screen.findByRole('heading', { name: 'Example Summer League' });
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument();
    first.unmount();
    mountDocked(false, '?tab=rounds');
    await screen.findByRole('heading', { name: 'Example Summer League' });
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument();
  });
  it('moves What to show to the dock on Standings, with a badge, and only when there is something to choose', async () => {
    const multiSeason: SeasonView = { ...season, ageGroup: 'All age groups', canManage: false, rounds: [
      { ...season.rounds[0], id: 'round-1', sectionName: 'Seniors', ageGroup: 'Seniors', orderIndex: 1 },
      { ...season.rounds[0], id: 'round-2', sectionName: 'Under 12', ageGroup: 'Under 12', orderIndex: 2 },
    ] };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? standings : multiSeason }));
    const user = userEvent.setup();
    const view = render(<TickerProvider><DockProbe /><MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter></TickerProvider>);
    const dock = await screen.findByTestId('dock');
    expect(dock).toHaveTextContent('Age group and what to show');
    expect(screen.queryByRole('button', { name: /^All age groups, Teams/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /All age groups/ })).toBeInTheDocument();
    await user.click(dock);
    await user.click(within(await screen.findByRole('group', { name: 'Age group' })).getByRole('button', { name: 'Under 12' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('dock')).toHaveAttribute('data-count', '1');
    view.unmount();
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.endsWith('/standings') ? standings : season }));
    render(<TickerProvider><DockProbe /><MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter></TickerProvider>);
    await screen.findByRole('heading', { name: /Seniors/ });
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument();
  });
  it('requires a reviewed preview before publication and handles changed source results', async () => {
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { data: { message: 'Results changed. Preview again.' } } });
    mount(true);
    await screen.findByRole('heading', { name: 'Example Summer League' });
    await userEvent.click(screen.getByRole('link', { name: 'Rounds' }));
    await userEvent.click(screen.getByRole('button', { name: /Round 1.*Example Meadow Cup/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview publication' }));
    const publish = await screen.findByRole('button', { name: 'Publish version 2' });
    expect(screen.getByText(/Section total points across all completed races/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(publish);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/seasons/example-season/rounds/round-1/publications', { sourceFingerprint: 'preview-fingerprint', expectedVersion: 2 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Results changed. Preview again.');
    expect(screen.queryByRole('button', { name: 'Publish version 2' })).not.toBeInTheDocument();
  });

  it('keeps a section-load failure visible and retries only that request', async () => {
    let detailCalls = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.endsWith('/standings')) return { data: standings };
      if (url === '/seasons/example-season') return { data: { ...season, canManage: true } };
      if (url === '/competitions') return { data: [{ id: 12, name: 'Spring', startDate: '2031-05-04' }] };
      if (url === '/competitions/12') { detailCalls += 1; throw new Error('offline'); }
      throw new Error(`Unexpected GET ${url}`);
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/seasons/example-season?tab=rounds']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Add a round' }));
    chooseOption(await screen.findByLabelText('Competition'), '12');
    expect(await screen.findByRole('alert')).toHaveTextContent('competition couldn’t be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('competition couldn’t be loaded');
    expect(detailCalls).toBe(2);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions')).toHaveLength(1);
    expect(screen.queryByText('Loading sections…')).not.toBeInTheDocument();
  });
});

describe('SeasonsPage', () => {
  const other: SeasonView = { ...season, id: 'older', title: 'Example Winter League', year: 2025, bestResultsToCount: null };
  function mountList(canCreate: boolean) {
    vi.mocked(api.get).mockResolvedValue({ data: [other, season] });
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u' }, canOrganise: () => canCreate, hasRole: () => false, canEdit: () => true } as unknown as ReturnType<typeof useAuth>);
    return render(<MemoryRouter initialEntries={['/seasons']}><Routes><Route path="/seasons" element={<SeasonsPage />} /><Route path="/seasons/:seasonId" element={<p>Season page</p>} /></Routes></MemoryRouter>);
  }
  it('groups seasons under year labels, newest first, as rows that link to the season', async () => {
    mountList(false);
    expect(await screen.findByRole('link', { name: /Example Summer League/ })).toHaveAttribute('href', '/seasons/example-season');
    const years = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(years[0]).toMatch(/^2026/);
    expect(years[1]).toMatch(/^2025/);
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
    // No eyebrow and no count of seasons next to the year.
    expect(screen.queryByText(/Published standings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b1 season\b/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Season tables|Rider & pony stats|Past competitions/ })).not.toBeInTheDocument();
  });
  it('puts Create a season by the ticker dock instead of an inline bar', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [other, season] });
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u' }, canOrganise: () => true, hasRole: () => false, canEdit: () => true } as unknown as ReturnType<typeof useAuth>);
    const user = userEvent.setup();
    render(<TickerProvider><DockProbe /><MemoryRouter initialEntries={['/seasons']}><Routes><Route path="/seasons" element={<SeasonsPage />} /></Routes></MemoryRouter></TickerProvider>);
    const dock = await screen.findByTestId('dock');
    expect(dock).toHaveTextContent('Create a season');
    expect(screen.getAllByRole('button', { name: 'Create a season' })).toHaveLength(1);
    await user.click(dock);
    expect(await screen.findByRole('heading', { name: 'Create a season' })).toBeInTheDocument();
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument();
  });
  it('opens the create form from the header action even when admin edit mode is off, and cancels back to the list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [other, season] });
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u' }, canOrganise: () => true, hasRole: (r: string) => r === 'Admin', canEdit: () => false } as unknown as ReturnType<typeof useAuth>);
    render(<MemoryRouter initialEntries={['/seasons']}><Routes><Route path="/seasons" element={<SeasonsPage />} /><Route path="/seasons/:seasonId" element={<p>Season page</p>} /></Routes></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Create a season' }));
    expect(screen.getByRole('heading', { name: 'Create a season' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Seasons' })).toBeInTheDocument();
  });
});
