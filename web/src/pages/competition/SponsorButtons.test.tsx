import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { StreamOverlay } from '../../types';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { competition, sponsor } from '../../test/factories';
import { CompetitionContext, type CompetitionCtx } from './context';
import { SponsorButtons } from './BroadcastPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

function show(overlay: StreamOverlay | undefined, extra: Partial<CompetitionCtx> = {}) {
  const value: CompetitionCtx = {
    competition: competition(), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay, saveOverlay: vi.fn(async () => 'saved' as const), sponsors: [sponsor(1, { showOn: 16 })], ...extra,
  };
  return { value, ...render(<CompetitionContext.Provider value={value}><SponsorButtons competitionId={1} /></CompetitionContext.Provider>) };
}

describe('SponsorButtons on the filming phone', () => {
  it('turns the sponsor cards off and back on', async () => {
    const save = vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
      expect(change({ ...DEFAULT_OVERLAY, sponsorMode: 0 }).sponsorMode).toBe(2);
      expect(change({ ...DEFAULT_OVERLAY, sponsorMode: 2 }).sponsorMode).toBe(0);
      return 'saved' as const;
    });
    show(DEFAULT_OVERLAY, { saveOverlay: save });
    expect(screen.getByRole('button', { name: 'Turn sponsors off' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn sponsors off' })); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('offers to turn them on when off, and no skip', () => {
    show({ ...DEFAULT_OVERLAY, sponsorMode: 2 });
    expect(screen.getByRole('button', { name: 'Turn sponsors on' })).toHaveTextContent('Sponsors off');
    expect(screen.queryByRole('button', { name: 'Skip sponsor' })).toBeNull();
  });

  it('skips to the next sponsor for everyone, and shrugs off a failure', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new Error('no signal'));
    show(undefined);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip sponsor' })); });
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sponsors/skip');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip sponsor' })); });
    expect(screen.getByRole('button', { name: 'Skip sponsor' })).toBeEnabled();
  });

  it('stays hidden with no sponsor on the video or no way to save', () => {
    expect(show(DEFAULT_OVERLAY, { sponsors: [sponsor(1, { showOn: 1 })] }).container).toBeEmptyDOMElement();
    expect(show(DEFAULT_OVERLAY, { saveOverlay: undefined }).container.textContent).toBe('');
    expect(show(DEFAULT_OVERLAY, { sponsors: undefined }).container.textContent).toBe('');
  });

  it('shows for the small logo alone', () => {
    show(DEFAULT_OVERLAY, { sponsors: [sponsor(1, { showOn: 8 })] });
    expect(screen.getByRole('button', { name: 'Turn sponsors off' })).toBeInTheDocument();
  });
});
