import type { CSSProperties } from 'react';
import type { OverlayBannerStyle, OverlayMode, StreamOverlay } from '../types';

export type OverlayElement = 'logo' | 'viewers' | 'arena' | 'clock' | 'strip' | 'scoreCard' | 'banner';
export type OverlayPlace = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'right';
export type OverlaySize = 'small' | 'medium' | 'large';

/** Where each element can go: a short fixed list, not free placement. */
export const ELEMENT_PLACES: Record<OverlayElement, OverlayPlace[]> = {
  logo: ['top-left', 'top-right'],
  viewers: ['top-left', 'top-right'],
  arena: ['top-left', 'top-right', 'bottom-left'],
  clock: ['top-right', 'top-left', 'bottom-right'],
  strip: ['bottom', 'top'],
  scoreCard: ['right', 'bottom'],
  banner: ['bottom', 'top'],
};

export interface OverlayLook {
  /** Highlight colour, e.g. the "+6" chip and the strip's edge. */
  accent: string;
  /** Background of strips, cards and banners. */
  background: string;
  size: OverlaySize;
  /** An https link to the event or club logo. */
  logoUrl: string | null;
  elements: Record<OverlayElement, { show: boolean; place: OverlayPlace }>;
}

export const DEFAULT_LOOK: OverlayLook = {
  accent: '#F5B82E',
  background: '#0F1E3D',
  size: 'medium',
  logoUrl: null,
  elements: {
    logo: { show: false, place: 'top-right' },
    viewers: { show: true, place: 'top-left' },
    arena: { show: false, place: 'top-left' },
    clock: { show: false, place: 'top-right' },
    strip: { show: true, place: 'bottom' },
    scoreCard: { show: true, place: 'right' },
    banner: { show: true, place: 'bottom' },
  },
};

export const DEFAULT_OVERLAY: StreamOverlay = {
  bannerText: null, bannerStyle: 0, bannerArenas: [], stripMode: 0, scoreCardMode: 0,
  scoreCardDelaySeconds: 4, scoreCardSeconds: 10, sponsorMode: 0, look: {}, revision: 0, updatedAt: null,
};

const HEX = /^#[0-9a-f]{6}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Reads a stored look, falling back to the defaults for anything missing or malformed. */
export function parseLook(raw: unknown): OverlayLook {
  const look = isRecord(raw) ? raw : {};
  const elements = isRecord(look.elements) ? look.elements : {};
  const parsed = {} as OverlayLook['elements'];
  for (const key of Object.keys(DEFAULT_LOOK.elements) as OverlayElement[]) {
    const fallback = DEFAULT_LOOK.elements[key];
    const element = isRecord(elements[key]) ? elements[key] : {};
    parsed[key] = {
      show: typeof element.show === 'boolean' ? element.show : fallback.show,
      place: oneOf(element.place, ELEMENT_PLACES[key], fallback.place),
    };
  }
  return {
    accent: typeof look.accent === 'string' && HEX.test(look.accent) ? look.accent : DEFAULT_LOOK.accent,
    background: typeof look.background === 'string' && HEX.test(look.background) ? look.background : DEFAULT_LOOK.background,
    size: oneOf(look.size, ['small', 'medium', 'large'] as const, DEFAULT_LOOK.size),
    logoUrl: httpsUrl(look.logoUrl),
    elements: parsed,
  };
}

const MODES: readonly OverlayMode[] = [0, 1, 2];
const STYLES: readonly OverlayBannerStyle[] = [0, 1, 2];
const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) ? value : fallback);

/**
 * Checks an overlay response before use. An older API answers unknown routes with the app's HTML page
 * (turned into an error by `api.ts`), and anything malformed is treated as "no overlays".
 */
export function parseOverlay(raw: unknown): StreamOverlay | null {
  if (!isRecord(raw) || typeof raw.revision !== 'number') return null;
  return {
    bannerText: typeof raw.bannerText === 'string' && raw.bannerText.trim() ? raw.bannerText : null,
    bannerStyle: oneOf(raw.bannerStyle, STYLES, 0),
    bannerArenas: Array.isArray(raw.bannerArenas) ? raw.bannerArenas.filter((arena): arena is string => typeof arena === 'string') : [],
    stripMode: oneOf(raw.stripMode, MODES, 0),
    scoreCardMode: oneOf(raw.scoreCardMode, MODES, 0),
    scoreCardDelaySeconds: whole(raw.scoreCardDelaySeconds, DEFAULT_OVERLAY.scoreCardDelaySeconds),
    scoreCardSeconds: whole(raw.scoreCardSeconds, DEFAULT_OVERLAY.scoreCardSeconds),
    sponsorMode: oneOf(raw.sponsorMode, MODES, 0),
    look: isRecord(raw.look) ? raw.look : {},
    revision: raw.revision,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

/** Whether the banner shows on a stream from this arena. */
export function bannerShowsIn(overlay: StreamOverlay, arenaName: string): boolean {
  return overlay.bannerText !== null && (overlay.bannerArenas.length === 0 || overlay.bannerArenas.includes(arenaName));
}

/** The request body that saves `overlay`, expecting the server to still hold `revision`. */
export function overlayRequest(overlay: StreamOverlay) {
  return {
    bannerText: overlay.bannerText, bannerStyle: overlay.bannerStyle, bannerArenas: overlay.bannerArenas,
    stripMode: overlay.stripMode, scoreCardMode: overlay.scoreCardMode,
    scoreCardDelaySeconds: overlay.scoreCardDelaySeconds, scoreCardSeconds: overlay.scoreCardSeconds, sponsorMode: overlay.sponsorMode,
    look: overlay.look, expectedRevision: overlay.revision,
  };
}

/** CSS variables the overlay pieces read, so a look recolours them all at once. */
export function lookStyle(look: OverlayLook): CSSProperties {
  return { '--ov-accent': look.accent, '--ov-bg': look.background } as CSSProperties;
}
