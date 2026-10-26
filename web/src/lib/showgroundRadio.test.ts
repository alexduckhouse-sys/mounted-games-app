import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildShowgroundRadioMetadata,
  SHOWGROUND_RADIO_TITLE,
  syncShowgroundRadioMediaSession,
} from './showgroundRadio';

describe('showgroundRadio', () => {
  const originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  const originalMediaMetadata = globalThis.MediaMetadata;

  afterEach(() => {
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      Reflect.deleteProperty(navigator, 'mediaSession');
    }
    globalThis.MediaMetadata = originalMediaMetadata;
  });

  it('builds competition & arena metadata with sensible fallbacks', () => {
    expect(
      buildShowgroundRadioMetadata({
        competitionName: 'British Championships',
        arenaName: 'Arena 1',
        heatLabel: 'Heat 4',
      }),
    ).toEqual({
      title: 'Arena 1 · Heat 4',
      artist: 'British Championships',
      album: SHOWGROUND_RADIO_TITLE,
    });

    expect(buildShowgroundRadioMetadata({})).toEqual({
      title: 'Main Arena — Live Commentary',
      artist: 'Mounted Games Live',
      album: SHOWGROUND_RADIO_TITLE,
    });
  });

  it('sets and clears navigator.mediaSession.metadata with and without MediaMetadata constructor', () => {
    const fakeSession: { metadata: unknown } = { metadata: null };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: fakeSession,
    });

    Reflect.deleteProperty(globalThis, 'MediaMetadata');
    const applied = syncShowgroundRadioMediaSession(true, {
      competitionName: 'Spring Friendly',
      arenaName: 'Ring 2',
    });
    expect(applied?.title).toBe('Ring 2 — Live Commentary');
    expect(fakeSession.metadata).toEqual(applied);

    const CustomMediaMetadata = vi.fn(function (this: Record<string, unknown>, init: unknown) {
      Object.assign(this, init);
    });
    globalThis.MediaMetadata = CustomMediaMetadata as unknown as typeof MediaMetadata;

    syncShowgroundRadioMediaSession(true, {
      competitionName: 'Spring Friendly',
      arenaName: 'Ring 2',
      heatLabel: 'A Final',
    });
    expect(CustomMediaMetadata).toHaveBeenCalledWith({
      title: 'Ring 2 · A Final',
      artist: 'Spring Friendly',
      album: SHOWGROUND_RADIO_TITLE,
    });

    expect(syncShowgroundRadioMediaSession(false, {})).toBeNull();
    expect(fakeSession.metadata).toBeNull();
  });

  it('returns null safely when navigator.mediaSession is unavailable', () => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    expect(syncShowgroundRadioMediaSession(true, { competitionName: 'Test' })).toBeNull();
  });
});
