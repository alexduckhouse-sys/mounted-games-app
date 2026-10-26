import type { StreamOverlay } from '../types';

/** The choices on the Overlay tab, in the order they appear. */
export type OverlayTileId = 'none' | 'auto' | 'soon' | 'toplist' | 'heat' | 'podium' | 'result' | 'next' | 'title' | 'sponsor';

export interface OverlayTile {
  id: OverlayTileId;
  label: string;
  /** Viewers draw this today. Tiles without it can be chosen and are saved, but show nothing yet. */
  drawn: boolean;
  /** Has settings behind the chevron. */
  settings: boolean;
}

export const OVERLAY_TILES: OverlayTile[] = [
  { id: 'none', label: 'None', drawn: true, settings: false },
  { id: 'auto', label: 'Automatic', drawn: true, settings: false },
  { id: 'soon', label: 'Back soon', drawn: true, settings: false },
  { id: 'toplist', label: 'Toplist', drawn: true, settings: true },
  { id: 'heat', label: 'Heat table', drawn: true, settings: true },
  { id: 'podium', label: 'Podium', drawn: false, settings: true },
  { id: 'result', label: 'Race result', drawn: false, settings: true },
  { id: 'next', label: 'Up next', drawn: true, settings: true },
  { id: 'title', label: 'Race title', drawn: false, settings: false },
  { id: 'sponsor', label: 'Sponsors', drawn: true, settings: true },
];

/** The one-tap grid on the Commentary desk: the cards, with None called Off. */
export const DESK_TILES: { id: OverlayTileId; label: string }[] = OVERLAY_TILES
  .filter((tile) => tile.id !== 'auto' && tile.id !== 'soon')
  .map((tile) => ({ id: tile.id, label: tile.id === 'none' ? 'Off' : tile.label }));

/** Per-card choices, saved in `overlay.look.liveOptions` so every device sees the same ones. */
export interface LiveOptions {
  toplistRows: 3 | 5 | 8;
  heatShow: 'each' | 'total';
  podiumReveal: 'all' | 'one';
  podiumSectionId: number | null;
  /** How many places have been revealed so far (0 to 3) when the podium reveals one at a time. */
  podiumShown: number;
  resultRaceId: number | null;
  nextCount: 1 | 3;
  sponsorSize: 'full' | 'corner';
}

export const DEFAULT_LIVE_OPTIONS: LiveOptions = {
  toplistRows: 5, heatShow: 'each', podiumReveal: 'all', podiumSectionId: null, podiumShown: 0, resultRaceId: null, nextCount: 1, sponsorSize: 'full',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const idOrNull = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);
const lookOf = (overlay: StreamOverlay): Record<string, unknown> => (isRecord(overlay.look) ? overlay.look : {});

export function readLiveOptions(overlay: StreamOverlay): LiveOptions {
  const raw = lookOf(overlay).liveOptions;
  const options = isRecord(raw) ? raw : {};
  const shown = typeof options.podiumShown === 'number' && Number.isInteger(options.podiumShown) ? Math.min(3, Math.max(0, options.podiumShown)) : 0;
  return {
    toplistRows: pick(options.toplistRows, [3, 5, 8] as const, DEFAULT_LIVE_OPTIONS.toplistRows),
    heatShow: pick(options.heatShow, ['each', 'total'] as const, DEFAULT_LIVE_OPTIONS.heatShow),
    podiumReveal: pick(options.podiumReveal, ['all', 'one'] as const, DEFAULT_LIVE_OPTIONS.podiumReveal),
    podiumSectionId: idOrNull(options.podiumSectionId),
    podiumShown: shown,
    resultRaceId: idOrNull(options.resultRaceId),
    nextCount: pick(options.nextCount, [1, 3] as const, DEFAULT_LIVE_OPTIONS.nextCount),
    sponsorSize: pick(options.sponsorSize, ['full', 'corner'] as const, DEFAULT_LIVE_OPTIONS.sponsorSize),
  };
}

const CARD_IDS: readonly OverlayTileId[] = ['none', 'auto', 'toplist', 'heat', 'podium', 'result', 'next', 'title', 'sponsor'];

/** The card the producer chose, ignoring Back soon (that comes from the camera being paused). */
export function readCard(overlay: StreamOverlay): Exclude<OverlayTileId, 'soon'> {
  const card = lookOf(overlay).liveCard;
  return CARD_IDS.includes(card as OverlayTileId) ? (card as Exclude<OverlayTileId, 'soon'>) : 'none';
}

/** The tile that shows as on: Back soon while the camera is paused, else the chosen card. */
export function activeTile(overlay: StreamOverlay, paused: boolean): OverlayTileId {
  return paused ? 'soon' : readCard(overlay);
}

/** Choosing a card. Sponsors also switch the sponsor cards on; any other card puts them back on automatic. */
export function chooseCard(overlay: StreamOverlay, card: Exclude<OverlayTileId, 'soon'>): StreamOverlay {
  const { liveSectionId: _followRacing, ...look } = lookOf(overlay);
  void _followRacing;
  const options = readLiveOptions(overlay);
  const liveOptions: LiveOptions = card === 'podium' ? { ...options, podiumShown: options.podiumReveal === 'one' ? 0 : 3 } : options;
  const sponsorMode = card === 'sponsor' ? 1 : overlay.sponsorMode === 1 ? 0 : overlay.sponsorMode;
  return { ...overlay, sponsorMode, look: { ...look, liveCard: card, liveOptions } };
}

export function changeOptions(overlay: StreamOverlay, patch: Partial<LiveOptions>): StreamOverlay {
  const options = { ...readLiveOptions(overlay), ...patch };
  if (patch.podiumReveal) options.podiumShown = patch.podiumReveal === 'one' ? 0 : 3;
  return { ...overlay, look: { ...lookOf(overlay), liveOptions: options } };
}

/** The banner text, ignoring the old way of storing a card name there. */
export function bannerMessage(overlay: StreamOverlay): string {
  const text = overlay.bannerText ?? '';
  return ['toplist', 'heat', 'lanes', 'next'].includes(text) ? '' : text;
}
