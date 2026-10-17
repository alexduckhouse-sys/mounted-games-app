import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { SeasonPage } from './SeasonPage';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import type { SeasonView } from './seasonViewTypes';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'example-organiser' }, canOrganise: () => true, hasRole: () => false, canEdit: () => true }) }));
const season: SeasonView = {
  id: 'example-season', title: 'Example Summer League', year: 2026, format: 2, ageGroup: 'Seniors',
  bestResultsToCount: 1, placePoints: [{ place: 1, points: 10 }, { place: 2, points: 8 }], canManage: false,
  rounds: [{ id: 'round-1', competitionId: 1, competitionName: 'Example Meadow Cup', competitionDate: '2026-06-01T00:00:00Z', competitionSectionId: 1, sectionName: 'Seniors', orderIndex: 1, isIncluded: true, publishedVersion: 1, publishedAt: '2026-06-01T17:00:00Z', publicationIsCurrent: true }],
};
const standings = { standings: [
  { rank: 1, teamProfileId: 'team-a', teamName: 'Example Blue', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 1, seasonPoints: 10, counted: true }] },
  { rank: 1, teamProfileId: 'team-b', teamName: 'Example Red', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 2, seasonPoints: 8, counted: false }] },
] };

function mount(canManage = false) {
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
  return render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SeasonSettingsForm', () => {
  it('saves custom points and a best-results limit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SeasonSettingsForm value={season} onSave={save} onCancel={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Points by place'));
    await userEvent.type(screen.getByLabelText('Points by place'), '12, 9, 6, 0');
    await userEvent.clear(screen.getByLabelText('Best results to count'));
    await userEvent.type(screen.getByLabelText('Best results to count'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bestResultsToCount: 3, placePoints: [{ place: 1, points: 12 }, { place: 2, points: 9 }, { place: 3, points: 6 }, { place: 4, points: 0 }] }));
  });
  it('rejects increasing place points before sending them', async () => {
    const save = vi.fn();
    render(<SeasonSettingsForm value={season} onSave={save} onCancel={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Points by place'));
    await userEvent.type(screen.getByLabelText('Points by place'), '10, 12');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no increase for a lower place');
    expect(save).not.toHaveBeenCalled();
  });
  it('shows a failed save and leaves the entered settings available to retry', async () => {
    render(<SeasonSettingsForm value={season} onSave={vi.fn().mockRejectedValue(new Error('offline'))} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be saved');
    expect(screen.getByLabelText('Season name')).toHaveValue('Example Summer League');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  });
});

describe('SeasonPage', () => {
  it('shows shared places, dropped round scores and profile links without management controls', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Example Summer League' })).toBeInTheDocument();
    expect(screen.getAllByText('=1')).toHaveLength(2);
    expect(screen.getByText(/not counted/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example Blue' })).toHaveAttribute('href', '/team-profiles/team-a');
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rounds (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Round details' }));
    expect(screen.getByText('Published versions')).toBeInTheDocument();
  });
  it('requires a reviewed preview before publication and handles changed source results', async () => {
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { data: { message: 'Results changed. Preview again.' } } });
    mount(true);
    await screen.findByRole('heading', { name: 'Example Summer League' });
    await userEvent.click(screen.getByRole('button', { name: 'Rounds (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review round' }));
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
    render(<MemoryRouter initialEntries={['/seasons/example-season']}><Routes><Route path="/seasons/:seasonId" element={<SeasonPage />} /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Rounds (1)' }));
    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.selectOptions(await screen.findByLabelText('Competition'), '12');
    expect(await screen.findByRole('alert')).toHaveTextContent('competition couldn’t be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('competition couldn’t be loaded');
    expect(detailCalls).toBe(2);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions')).toHaveLength(1);
    expect(screen.queryByText('Loading sections…')).not.toBeInTheDocument();
  });
});
