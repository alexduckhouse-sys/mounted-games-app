import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SHOWGROUND_RADIO_TITLE } from '../lib/showgroundRadio';
import { useShowgroundRadio } from './useShowgroundRadio';

describe('useShowgroundRadio', () => {
  const originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');

  afterEach(() => {
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      Reflect.deleteProperty(navigator, 'mediaSession');
    }
  });

  it('synchronises navigator.mediaSession.metadata when active and clears on unmount', () => {
    const fakeSession: { metadata: unknown } = { metadata: null };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: fakeSession,
    });

    const { result, rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) =>
        useShowgroundRadio(active, {
          competitionName: 'Summer Championships',
          arenaName: 'Arena 1',
          heatLabel: 'Heat 2',
        }),
      { initialProps: { active: true } },
    );

    expect(result.current.bannerTitle).toBe(SHOWGROUND_RADIO_TITLE);
    expect(fakeSession.metadata).toMatchObject({
      title: 'Arena 1 · Heat 2',
      artist: 'Summer Championships',
      album: SHOWGROUND_RADIO_TITLE,
    });

    rerender({ active: false });
    expect(fakeSession.metadata).toBeNull();

    rerender({ active: true });
    expect(fakeSession.metadata).not.toBeNull();

    unmount();
    expect(fakeSession.metadata).toBeNull();
  });
});
