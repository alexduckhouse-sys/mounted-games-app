import { describe, expect, it } from 'vitest';
import * as StreamReplayInspector from './stream/ReplayInspector';
import * as BarrelReplayInspector from './ReplayInspector';

describe('ReplayInspector barrel re-export', () => {
  it('re-exports all symbols from stream/ReplayInspector', () => {
    expect(BarrelReplayInspector.ReplayInspector).toBe(StreamReplayInspector.ReplayInspector);
    expect(BarrelReplayInspector.SavedReplaysButton).toBe(StreamReplayInspector.SavedReplaysButton);
    expect(BarrelReplayInspector.SavedReplaysDrawer).toBe(StreamReplayInspector.SavedReplaysDrawer);
    expect(BarrelReplayInspector.interpolateFollowTransform).toBe(
      StreamReplayInspector.interpolateFollowTransform
    );
    expect(BarrelReplayInspector.capturePhotoFinishSnapshot).toBe(
      StreamReplayInspector.capturePhotoFinishSnapshot
    );
    expect(BarrelReplayInspector.renderTrimmedFollowClip).toBe(
      StreamReplayInspector.renderTrimmedFollowClip
    );
  });
});
