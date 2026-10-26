import { describe, expect, it } from 'vitest';
import { clockLabel, fitFrame, followFromKeys, frameAt, frameRect, keysFromFollow, putKey, zoomLabel, type FrameKey } from './replayFrame';

describe('frames', () => {
  it('keeps the frame inside the picture and the zoom in range', () => {
    expect(fitFrame({ x: 0, y: 100, z: 2 })).toEqual({ x: 25, y: 75, z: 2 });
    expect(fitFrame({ x: 50, y: 50, z: 9 })).toEqual({ x: 50, y: 50, z: 4 });
    expect(fitFrame({ x: 10, y: 10, z: 0.2 })).toEqual({ x: 50, y: 50, z: 1 });
  });

  it('turns a frame into a box over the video', () => {
    expect(frameRect({ x: 50, y: 50, z: 2 })).toEqual({ left: 25, top: 25, width: 50, height: 50 });
    expect(frameRect({ x: 0, y: 0, z: 4 })).toEqual({ left: 0, top: 0, width: 25, height: 25 });
  });

  it('moves in a straight line between keys and holds at the ends', () => {
    const keys: FrameKey[] = [{ t: 10, x: 30, y: 40, z: 2 }, { t: 0, x: 20, y: 30, z: 1 }];
    expect(frameAt([], 3)).toEqual({ x: 50, y: 50, z: 1 });
    expect(frameAt(keys, -1)).toMatchObject({ x: 20, z: 1 });
    expect(frameAt(keys, 99)).toMatchObject({ x: 30, z: 2 });
    expect(frameAt(keys, 5)).toEqual({ x: 25, y: 35, z: 1.5 });
  });

  it('changes the key at this moment, or adds one that starts from the frame on show', () => {
    const keys: FrameKey[] = [{ t: 0, x: 40, y: 50, z: 2 }, { t: 10, x: 60, y: 50, z: 2 }];
    const moved = putKey(keys, 0.1, { x: 45 });
    expect(moved).toHaveLength(2);
    expect(moved[0]).toMatchObject({ t: 0, x: 45, z: 2 });
    const added = putKey(keys, 5, { z: 3 });
    expect(added.map((k) => k.t)).toEqual([0, 5, 10]);
    expect(added[1]).toMatchObject({ x: 50, y: 50, z: 3 });
    expect(putKey([], 2.04, { z: 2 })).toEqual([{ t: 2, x: 50, y: 50, z: 2 }]);
    expect(putKey([], 1, { x: 0, y: 0, z: 2 })[0]).toMatchObject({ x: 25, y: 25 });
  });

  it('converts saved follow keyframes both ways', () => {
    const follow = followFromKeys([{ t: 1.234, x: 25, y: 75, z: 2.5 }], { width: 800, height: 450 });
    expect(follow).toEqual([{ timeSec: 1.23, zoom: 2.5, panX: 200, panY: -112, viewportWidth: 800, viewportHeight: 450 }]);
    const back = keysFromFollow(follow);
    expect(back[0].x).toBeCloseTo(25, 0);
    expect(back[0].y).toBeCloseTo(75, 0);
    expect(back[0].z).toBe(2.5);
    expect(keysFromFollow(undefined)).toEqual([]);
    expect(keysFromFollow([{ timeSec: 2, zoom: 1, panX: 0, panY: 0 }, { timeSec: 1, zoom: 1, panX: 0, panY: 0 }]).map((k) => k.t)).toEqual([1, 2]);
    expect(followFromKeys([{ t: 0, x: 50, y: 50, z: 1 }])[0]).toMatchObject({ panX: 0, panY: 0, viewportWidth: 1000 });
  });

  it('writes zoom and time labels', () => {
    expect(zoomLabel(2)).toBe('2×');
    expect(zoomLabel(2.5)).toBe('2.5×');
    expect(clockLabel(4.5)).toBe('0:04.5');
    expect(clockLabel(75.25)).toBe('1:15.3');
    expect(clockLabel(-1)).toBe('0:00.0');
  });
});
