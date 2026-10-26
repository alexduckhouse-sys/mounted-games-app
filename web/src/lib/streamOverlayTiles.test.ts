import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY } from './overlays';
import { DEFAULT_LIVE_OPTIONS, DESK_TILES, OVERLAY_TILES, activeTile, bannerMessage, changeOptions, chooseCard, readCard, readLiveOptions } from './streamOverlayTiles';

const withLook = (look: unknown) => ({ ...DEFAULT_OVERLAY, look });

describe('tiles', () => {
  it('lists None, Automatic and Back soon first, then the cards', () => {
    expect(OVERLAY_TILES.slice(0, 3).map((t) => t.label)).toEqual(['None', 'Automatic', 'Back soon']);
    expect(OVERLAY_TILES.filter((t) => !t.drawn).map((t) => t.id)).toEqual(['podium', 'result', 'title']);
    expect(DESK_TILES.map((t) => t.label)).toEqual(['Off', 'Toplist', 'Heat table', 'Podium', 'Race result', 'Up next', 'Race title', 'Sponsors']);
  });
});

describe('reading the overlay', () => {
  it('defaults when nothing is stored or the data is malformed', () => {
    expect(readLiveOptions(DEFAULT_OVERLAY)).toEqual(DEFAULT_LIVE_OPTIONS);
    expect(readLiveOptions(withLook({ liveOptions: { toplistRows: 4, heatShow: 'x', podiumShown: 9, nextCount: 3, sponsorSize: 'corner', resultRaceId: 'a', podiumSectionId: 7 } })))
      .toEqual({ ...DEFAULT_LIVE_OPTIONS, podiumShown: 3, nextCount: 3, sponsorSize: 'corner', podiumSectionId: 7 });
    expect(readLiveOptions(withLook({ liveOptions: { podiumShown: -2, toplistRows: 8, heatShow: 'total', podiumReveal: 'one' } })))
      .toMatchObject({ podiumShown: 0, toplistRows: 8, heatShow: 'total', podiumReveal: 'one' });
    expect(readLiveOptions(withLook([]))).toEqual(DEFAULT_LIVE_OPTIONS);
  });

  it('reads the chosen card, and shows Back soon while the camera is paused', () => {
    expect(readCard(DEFAULT_OVERLAY)).toBe('none');
    expect(readCard(withLook({ liveCard: 'lanes' }))).toBe('none');
    expect(readCard(withLook({ liveCard: 'heat' }))).toBe('heat');
    expect(activeTile(withLook({ liveCard: 'heat' }), false)).toBe('heat');
    expect(activeTile(withLook({ liveCard: 'heat' }), true)).toBe('soon');
  });

  it('ignores a card name stored as banner text', () => {
    expect(bannerMessage({ ...DEFAULT_OVERLAY, bannerText: 'toplist' })).toBe('');
    expect(bannerMessage({ ...DEFAULT_OVERLAY, bannerText: 'Lunch until 2pm' })).toBe('Lunch until 2pm');
    expect(bannerMessage(DEFAULT_OVERLAY)).toBe('');
  });
});

describe('changing the overlay', () => {
  it('choosing a card keeps the rest of the look, follows the racing and keeps options', () => {
    const next = chooseCard(withLook({ accent: '#112233', liveSectionId: 4, liveOptions: { toplistRows: 3 } }), 'toplist');
    expect(next.look).toEqual({ accent: '#112233', liveCard: 'toplist', liveOptions: { ...DEFAULT_LIVE_OPTIONS, toplistRows: 3 } });
  });

  it('turns sponsor cards on for Sponsors and back to automatic for any other card', () => {
    const sponsors = chooseCard(DEFAULT_OVERLAY, 'sponsor');
    expect(sponsors.sponsorMode).toBe(1);
    expect(chooseCard(sponsors, 'heat').sponsorMode).toBe(0);
    expect(chooseCard({ ...DEFAULT_OVERLAY, sponsorMode: 2 }, 'heat').sponsorMode).toBe(2);
  });

  it('starts the podium hidden when it reveals one place at a time', () => {
    const one = changeOptions(DEFAULT_OVERLAY, { podiumReveal: 'one' });
    expect(readLiveOptions(chooseCard({ ...one, look: { ...(one.look as object), liveOptions: { ...readLiveOptions(one), podiumShown: 2 } } }, 'podium')).podiumShown).toBe(0);
    expect(readLiveOptions(chooseCard(DEFAULT_OVERLAY, 'podium')).podiumShown).toBe(3);
  });

  it('sets options and resets the reveal step when the reveal changes', () => {
    const one = changeOptions(DEFAULT_OVERLAY, { podiumReveal: 'one' });
    expect(readLiveOptions(one)).toMatchObject({ podiumReveal: 'one', podiumShown: 0 });
    expect(readLiveOptions(changeOptions(one, { podiumShown: 2 })).podiumShown).toBe(2);
    expect(readLiveOptions(changeOptions(one, { podiumReveal: 'all' })).podiumShown).toBe(3);
    expect(readLiveOptions(changeOptions(DEFAULT_OVERLAY, { toplistRows: 8 })).toplistRows).toBe(8);
  });
});
