import type { FollowKeyframe } from '../live/replayBuffer';

/** The part of the video a replay shows: its centre as a percentage across and down, and a zoom (1 shows everything). */
export interface Frame { x: number; y: number; z: number }
/** A frame at a moment in the clip, in seconds. The replay moves from one key to the next as it plays. */
export interface FrameKey extends Frame { t: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.5;
const REFERENCE = { width: 1000, height: 562.5 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Keeps the frame inside the picture. */
export function fitFrame(frame: Frame): Frame {
  const z = clamp(frame.z, MIN_ZOOM, MAX_ZOOM);
  const half = 50 / z;
  return { x: clamp(frame.x, half, 100 - half), y: clamp(frame.y, half, 100 - half), z };
}

/** Where the frame sits over the video, as percentages for CSS. */
export function frameRect(frame: Frame) {
  const fitted = fitFrame(frame);
  const size = 100 / fitted.z;
  return { left: fitted.x - size / 2, top: fitted.y - size / 2, width: size, height: size };
}

/** The frame at a moment: it holds the first frame before the first key and the last frame after the last, and moves in a straight line between. */
export function frameAt(keys: FrameKey[], t: number): Frame {
  if (keys.length === 0) return { x: 50, y: 50, z: 1 };
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last;
  const after = sorted.findIndex((key) => key.t > t);
  const from = sorted[after - 1];
  const to = sorted[after];
  const f = (t - from.t) / (to.t - from.t);
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, z: from.z + (to.z - from.z) * f };
}

/** Changes the key at (or near) this moment, or adds one that starts from the frame on show there. */
export function putKey(keys: FrameKey[], t: number, patch: Partial<Frame>, tolerance = 0.25): FrameKey[] {
  const at = keys.findIndex((key) => Math.abs(key.t - t) <= tolerance);
  const base: FrameKey = at >= 0 ? keys[at] : { t: tenth(t), ...frameAt(keys, t) };
  const next: FrameKey = { ...base, ...fitFrame({ ...base, ...patch }), t: base.t };
  const list = at >= 0 ? keys.map((key, i) => (i === at ? next : key)) : [...keys, next];
  return list.sort((a, b) => a.t - b.t);
}

/** Saved follow keyframes keep a pan in pixels of the viewport they were made in; the editor works in percentages. */
export function keysFromFollow(follow: FollowKeyframe[] | undefined): FrameKey[] {
  return (follow ?? []).map((key) => {
    const width = key.viewportWidth || REFERENCE.width;
    const height = key.viewportHeight || REFERENCE.height;
    return fitFrameKey({ t: key.timeSec, x: 50 - (key.panX / width) * 100, y: 50 - (key.panY / height) * 100, z: key.zoom });
  }).sort((a, b) => a.t - b.t);
}

function fitFrameKey(key: FrameKey): FrameKey {
  return { ...fitFrame(key), t: key.t };
}

/** The other way, for saving: pan is how far the picture shifts to bring the centre to the middle (`scale(zoom) translate(pan)`). */
export function followFromKeys(keys: FrameKey[], viewport: { width?: number; height?: number } = {}): FollowKeyframe[] {
  const width = viewport.width || REFERENCE.width;
  const height = viewport.height || REFERENCE.height;
  return keys.map((key) => ({
    timeSec: Number(key.t.toFixed(2)), zoom: Number(key.z.toFixed(2)),
    panX: Math.round(((50 - key.x) / 100) * width), panY: Math.round(((50 - key.y) / 100) * height),
    viewportWidth: width, viewportHeight: height,
  }));
}

export function zoomLabel(z: number): string {
  return `${Number(z.toFixed(1))}×`;
}

/** "0:04.5" for a time in seconds. */
export function clockLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(1).padStart(4, '0')}`;
}
