import { afterEach, describe, expect, it, vi } from 'vitest';
import { failedRefreshOutcome, refreshOutcomeFor } from './refreshOutcome';

afterEach(() => { vi.unstubAllGlobals(); });

describe('failedRefreshOutcome', () => {
  it('calls a failure with the phone offline "no signal", and anything else a failure', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(failedRefreshOutcome()).toBe('offline');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(failedRefreshOutcome()).toBe('failed');
  });

  it('is a failure where there is no navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(failedRefreshOutcome()).toBe('failed');
  });
});

describe('refreshOutcomeFor', () => {
  it('says "same" when the answer matches what is shown, and "updated" when it differs or nothing was shown', () => {
    expect(refreshOutcomeFor({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe('same');
    expect(refreshOutcomeFor({ a: 1 }, { a: 2 })).toBe('updated');
    expect(refreshOutcomeFor(null, { a: 1 })).toBe('updated');
    expect(refreshOutcomeFor(undefined, { a: 1 })).toBe('updated');
  });

  it('says "updated" when the answer cannot be compared', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(refreshOutcomeFor(loop, loop)).toBe('updated');
  });
});
