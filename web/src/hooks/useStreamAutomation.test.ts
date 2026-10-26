import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OVERLAY } from '../lib/overlays';
import { DEFAULT_AUTO, type AutoState } from '../lib/streamAuto';
import { readCard } from '../lib/streamOverlayTiles';
import { competition, heat, race, session } from '../test/factories';
import type { StreamOverlay } from '../types';
import { useStreamAutomation } from './useStreamAutomation';

const on: AutoState = { ...DEFAULT_AUTO, on: true };
const comp = (done: number[], sessions = 2) => competition({
  sessions: Array.from({ length: sessions }, (_, i) => session(i + 1, {
    orderIndex: i + 1, competitionSectionId: 5,
    heats: [heat(i + 1, { races: [1, 2].map((n) => race(i * 10 + n, { isComplete: done.includes(i * 10 + n) })) })],
  })),
});

function setup(auto: AutoState = on, base: number[] = [1]) {
  let overlay: StreamOverlay = DEFAULT_OVERLAY;
  let props = { done: base, auto, save: true };
  let rerender: (next: typeof props) => void = () => {};
  const saveOverlay = vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
    overlay = change(overlay);
    act(() => rerender(props));
    return 'saved' as const;
  });
  const hook = renderHook((p: typeof props) => useStreamAutomation({ competition: comp(p.done), overlay, saveOverlay: p.save ? saveOverlay : undefined, auto: p.auto }), { initialProps: props });
  rerender = hook.rerender;
  const refresh = (patch: Partial<typeof props>) => { props = { done: base, auto, save: true, ...patch }; hook.rerender(props); };
  return {
    saveOverlay, refresh, hook, card: () => readCard(overlay),
    setOverlay: (next: StreamOverlay) => { overlay = next; hook.rerender(props); },
  };
}

describe('useStreamAutomation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing for races that were already finished when the page opened', () => {
    const { saveOverlay, refresh } = setup();
    refresh({ done: [1] });
    expect(saveOverlay).not.toHaveBeenCalled();
  });

  it('shows the heat table after a race for its time, then puts back what was on screen', async () => {
    const t = setup(on, []);
    t.refresh({ done: [1] });
    await act(async () => {});
    expect(t.card()).toBe('heat');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(t.card()).toBe('none');
    expect(t.saveOverlay).toHaveBeenCalledTimes(2);
  });

  it('runs the steps in turn: heat, then the toplist from session 2', async () => {
    const t = setup();
    t.refresh({ done: [1, 2, 11] });
    // session 2, race 3 of the section: toplist is every 2 races, so only the heat table
    await act(async () => {});
    expect(t.card()).toBe('heat');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    t.refresh({ done: [1, 2, 11, 12] });
    await act(async () => {});
    expect(t.card()).toBe('heat');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(t.card()).toBe('toplist');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    // the session is finished, so the podium follows the toplist
    expect(t.card()).toBe('podium');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(t.card()).toBe('none');
  });

  it('stops quietly when the producer picks a card by hand', async () => {
    const t = setup();
    t.refresh({ done: [1, 2] });
    await act(async () => {});
    t.setOverlay({ ...DEFAULT_OVERLAY, look: { liveCard: 'toplist' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(t.card()).toBe('toplist');
    expect(t.saveOverlay).toHaveBeenCalledTimes(1);
  });

  it('does not run when automations are off, nothing is due, or the overlay cannot be changed', async () => {
    const off = setup({ ...on, on: false });
    off.refresh({ done: [1, 2], auto: { ...on, on: false } });
    expect(off.saveOverlay).not.toHaveBeenCalled();

    const none = setup({ ...on, rules: { ...on.rules, race: { on: false, n: 10 }, podium: { on: false, n: 0 } } });
    none.refresh({ done: [1, 2], auto: { ...on, rules: { ...on.rules, race: { on: false, n: 10 }, podium: { on: false, n: 0 } } } });
    expect(none.saveOverlay).not.toHaveBeenCalled();

    const readOnly = setup();
    readOnly.refresh({ done: [1, 2], save: false });
    expect(readOnly.saveOverlay).not.toHaveBeenCalled();
  });

  it('puts the card back when the page closes mid-run, and keeps the earlier card for a second race', async () => {
    const t = setup();
    t.setOverlay({ ...DEFAULT_OVERLAY, look: { liveCard: 'next' } });
    t.refresh({ done: [1, 2] });
    await act(async () => {});
    expect(t.card()).toBe('heat');
    t.refresh({ done: [1, 2, 11] });
    await act(async () => {});
    t.hook.unmount();
    await act(async () => {});
    expect(t.card()).toBe('next');
  });
});
