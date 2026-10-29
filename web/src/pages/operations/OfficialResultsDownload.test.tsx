import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { downloadCsv } from '../../lib/csv';
import { OfficialResultsDownload } from './OfficialResultsDownload';
vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../lib/csv', async (original) => ({ ...await original<typeof import('../../lib/csv')>(), downloadCsv: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/competitions/7') return { data: { name: 'Demo games', teams: [] } };
    if (String(path).endsWith('/results')) return { data: { sections: [] } };
    return { data: { heats: [] } };
  });
});
describe('official results download', () => {
  it('downloads directly from its button without opening a different print sheet', async () => {
    render(<OfficialResultsDownload competitionId={7} />);
    await userEvent.click(screen.getByRole('button', { name: /Official results pack/ }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith('Demo_games-official-results-pack.csv', expect.stringContaining('Section')));
  });
  it.each(['/print/results', '/print/score-sheets'])('does not produce an incomplete pack when %s fails', async (unavailable) => {
    const success = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path, config) => String(path).endsWith(unavailable)
      ? Promise.reject({ response: { data: { detail: 'Results are unavailable. Try again.' } } })
      : success(path, config));
    render(<OfficialResultsDownload competitionId={7} />);
    await userEvent.click(screen.getByRole('button', { name: /Official results pack/ }));
    expect(await screen.findByText('Results are unavailable. Try again.')).toBeInTheDocument();
    expect(downloadCsv).not.toHaveBeenCalled();
  });
});
