import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StreamOverlay } from '../../types';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { writeMessages } from '../../lib/overlayMessages';
import { competition } from '../../test/factories';
import { CompetitionContext, type CompetitionCtx } from './context';
import { BannerButton } from './BroadcastPage';

function show(overlay: StreamOverlay | undefined, saveOverlay?: CompetitionCtx['saveOverlay']) {
  const value: CompetitionCtx = { competition: competition(), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [], overlay, saveOverlay };
  return render(<CompetitionContext.Provider value={value}><BannerButton competitionId={1} /></CompetitionContext.Provider>);
}

describe('BannerButton on the filming phone', () => {
  it('clears the banner that is up', async () => {
    const save = vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => { expect(change({ ...DEFAULT_OVERLAY, bannerText: 'Lunch' }).bannerText).toBeNull(); return 'saved' as const; });
    show({ ...DEFAULT_OVERLAY, bannerText: 'Lunch' }, save);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear the banner' })); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('puts back the latest saved message when no banner is up', async () => {
    writeMessages(1, [{ text: 'Old', style: 0 }, { text: 'Prize giving at 4.30pm', style: 2 }]);
    const save = vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
      expect(change(DEFAULT_OVERLAY)).toMatchObject({ bannerText: 'Prize giving at 4.30pm', bannerStyle: 2 });
      return 'saved' as const;
    });
    show(undefined, save);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show banner: Prize giving at 4.30pm' })); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('stays hidden with nothing to show or no way to save', () => {
    const { container, unmount } = show(DEFAULT_OVERLAY, vi.fn());
    expect(container).toBeEmptyDOMElement();
    unmount();
    writeMessages(1, [{ text: 'x', style: 0 }]);
    expect(show(DEFAULT_OVERLAY).container).toBeEmptyDOMElement();
  });
});
