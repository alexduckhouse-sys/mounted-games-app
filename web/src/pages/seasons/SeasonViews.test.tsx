import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SeasonPage } from './SeasonPage';
import { SeasonsPage } from './SeasonsPage';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import type { SeasonView } from './seasonViewTypes';
import { chooseOption } from '../../test/select';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
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
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'example-organiser' }, canOrganise: () => true, hasRole: () => false, canEdit: () => true } as unknown as ReturnType<typeof useAuth>);
});

describe('SeasonSettingsForm', () => {
  it('saves custom points and a best-results limit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SeasonSettingsForm value={season} onSave={save} />);
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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bestResultsToCount: 3, placePoints: [{ place: 1, points: 12 }, { place: 2, points: 9 }, { place: 3, points: 6 }, { place: 4, points: 0 }] }));
  });
  it('shows the unsaved-changes bar only when something differs, and Discard restores the saved settings', async () => {
    render(<SeasonSettingsForm value={season} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('1st')).toHaveValue('10');
    expect(screen.getByLabelText('Did not finish / eliminated')).toHaveAttribute('readonly');
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '11');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('2nd'));
    await userEvent.type(screen.getByLabelText('2nd'), '7');
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('1st')).toHaveValue('10');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
  it('rejects increasing place points before sending them', async () => {
    const save = vi.fn();
    render(<SeasonSettingsForm value={season} onSave={save} />);
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no increase for a lower place');
    expect(save).not.toHaveBeenCalled();
  });
  it('shows a failed save and leaves the entered settings available to retry', async () => {
    render(<SeasonSettingsForm value={season} onSave={vi.fn().mockRejectedValue(new Error('offline'))} />);
    await userEvent.clear(screen.getByLabelText('Season name'));
    await userEvent.type(screen.getByLabelText('Season name'), 'Renamed league');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be saved');
    expect(screen.getByLabelText('Season name')).toHaveValue('Renamed league');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
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
  it('shows standings first with shared places, a footnote and profile links, and no management controls', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Example Summer League' })).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('=1')).toHaveLength(2);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Pos', 'Team', 'Rds', 'Pts']);
    expect(screen.getByRole('link', { name: 'Example Blue' })).toHaveAttribute('href', '/team-profiles/team-a');
    expect(screen.getByText(/Best 1 of 1 round · = shared place · after R1, 1 Jun/)).toHaveTextContent('not an official ranking unless the league says so');
    expect(screen.getByLabelText('Age section')).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
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
  it('keeps the active tab in the URL and hides Settings from people who cannot edit', async () => {
    mount(false, '/seasons/example-season?tab=settings');
    await screen.findByRole('heading', { name: 'Example Summer League' });
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Place points')).not.toBeInTheDocument();
  });
  it('lets an organiser edit settings, saves them and returns to the standings', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount(true);
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('1st'));
    await userEvent.type(screen.getByLabelText('1st'), '12');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/seasons/example-season', expect.objectContaining({ placePoints: [{ place: 1, points: 12 }, { place: 2, points: 8 }] })));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page'));
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

    await user.click(await screen.findByRole('button', { name: 'Add round' }));
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
    expect(screen.queryByRole('link', { name: /Create season/ })).not.toBeInTheDocument();
  });
  it('opens the create form from the header action and cancels back to the list', async () => {
    mountList(true);
    await userEvent.click(await screen.findByRole('link', { name: 'Create season' }));
    expect(screen.getByRole('heading', { name: 'Create a season' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Seasons' })).toBeInTheDocument();
  });
});
