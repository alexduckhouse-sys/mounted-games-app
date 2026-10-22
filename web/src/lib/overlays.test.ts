import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, DEFAULT_OVERLAY, bannerShowsIn, overlayRequest, parseLook, parseOverlay } from './overlays';

describe('parseLook', () => {
  it('falls back to the defaults for nothing or nonsense', () => {
    expect(parseLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(parseLook([1, 2])).toEqual(DEFAULT_LOOK);
    expect(parseLook({ accent: 'red', background: '#12345', size: 'huge', logoUrl: 42, elements: 'all' })).toEqual(DEFAULT_LOOK);
  });

  it('keeps valid colours, size, an https logo and element choices', () => {
    const look = parseLook({
      accent: '#ff0000', background: '#000000', size: 'large', logoUrl: 'https://example.com/logo.png',
      elements: { clock: { show: true, place: 'bottom-right' }, viewers: { show: false } },
    });
    expect(look).toMatchObject({ accent: '#ff0000', background: '#000000', size: 'large', logoUrl: 'https://example.com/logo.png' });
    expect(look.elements.clock).toEqual({ show: true, place: 'bottom-right' });
    expect(look.elements.viewers).toEqual({ show: false, place: 'top-left' });
    expect(look.elements.strip).toEqual(DEFAULT_LOOK.elements.strip);
  });

  it('refuses logos that are not https and places an element cannot go', () => {
    expect(parseLook({ logoUrl: 'http://example.com/logo.png' }).logoUrl).toBeNull();
    expect(parseLook({ logoUrl: 'not a url' }).logoUrl).toBeNull();
    expect(parseLook({ elements: { strip: { show: true, place: 'top-left' } } }).elements.strip.place).toBe('bottom');
  });
});

describe('parseOverlay', () => {
  it('rejects anything that is not an overlay response', () => {
    expect(parseOverlay(null)).toBeNull();
    expect(parseOverlay('<!doctype html>')).toBeNull();
    expect(parseOverlay({ bannerText: 'x' })).toBeNull();
  });

  it('cleans up each field', () => {
    expect(parseOverlay({
      bannerText: '  ', bannerStyle: 7, bannerArenas: ['Arena 1', 3], stripMode: 2, scoreCardMode: 'off',
      scoreCardDelaySeconds: 2.5, scoreCardSeconds: 12, look: [], revision: 3, updatedAt: 5,
    })).toEqual({
      bannerText: null, bannerStyle: 0, bannerArenas: ['Arena 1'], stripMode: 2, scoreCardMode: 0,
      scoreCardDelaySeconds: 4, scoreCardSeconds: 12, look: {}, revision: 3, updatedAt: null,
    });
  });

  it('keeps a well-formed response as it is', () => {
    const overlay = { ...DEFAULT_OVERLAY, bannerText: 'Lunch until 1pm', bannerStyle: 1, bannerArenas: 'none', look: { accent: '#ff0000' }, revision: 4, updatedAt: '2026-10-21T12:00:00Z' };
    expect(parseOverlay(overlay)).toEqual({ ...overlay, bannerArenas: [] });
  });
});

describe('bannerShowsIn', () => {
  it('shows a banner in every arena unless arenas are chosen', () => {
    const banner = { ...DEFAULT_OVERLAY, bannerText: 'Lunch' };
    expect(bannerShowsIn(banner, 'Arena 2')).toBe(true);
    expect(bannerShowsIn({ ...banner, bannerArenas: ['Arena 1'] }, 'Arena 2')).toBe(false);
    expect(bannerShowsIn({ ...banner, bannerArenas: ['Arena 1'] }, 'Arena 1')).toBe(true);
    expect(bannerShowsIn(DEFAULT_OVERLAY, 'Arena 1')).toBe(false);
  });
});

describe('overlayRequest', () => {
  it('sends the settings with the revision it expects', () => {
    const request = overlayRequest({ ...DEFAULT_OVERLAY, bannerText: 'Hi', revision: 5, updatedAt: 'x' });
    expect(request).toMatchObject({ bannerText: 'Hi', expectedRevision: 5, scoreCardSeconds: 10 });
    expect(request).not.toHaveProperty('updatedAt');
    expect(request).not.toHaveProperty('revision');
  });
});
