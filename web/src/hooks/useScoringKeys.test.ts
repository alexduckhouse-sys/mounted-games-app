import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoringKeyAction } from '../lib/scoringKeys';
import { useScoringKeys } from './useScoringKeys';

function key(k: string, target: EventTarget = document.body, extra: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  act(() => { target.dispatchEvent(event); });
  return event;
}

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useScoringKeys', () => {
  it('passes scoring keys on, uses them up and remembers a keypad for the session', () => {
    const onAction = vi.fn();
    const { result } = renderHook(() => useScoringKeys(true, onAction));
    expect(result.current).toBe(false);
    const event = key('2');
    expect(onAction).toHaveBeenCalledWith({ kind: 'place', lane: 2 });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current).toBe(true);
    expect(sessionStorage.getItem('mg.scoring.keypad')).toBe('1');
  });

  it('starts with the chip when a keypad was used earlier in the session', () => {
    sessionStorage.setItem('mg.scoring.keypad', '1');
    const { result } = renderHook(() => useScoringKeys(true, vi.fn()));
    expect(result.current).toBe(true);
  });

  it('does nothing while turned off, and stops listening when unmounted', () => {
    const onAction = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useScoringKeys(on, onAction), { initialProps: { on: false } });
    key('1');
    expect(onAction).not.toHaveBeenCalled();
    rerender({ on: true });
    key('1');
    expect(onAction).toHaveBeenCalledTimes(1);
    unmount();
    key('1');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('leaves alone keys the page has used, keys typed into fields and keys while a dialog is open', () => {
    const onAction = vi.fn();
    renderHook(() => useScoringKeys(true, onAction));
    const card = document.createElement('button');
    card.addEventListener('keydown', (e) => e.preventDefault());
    document.body.append(card);
    key('Backspace', card);
    const input = document.createElement('input');
    document.body.append(input);
    const typed = key('1', input);
    expect(typed.defaultPrevented).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    document.body.append(dialog);
    key('1');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('ignores keys that aren\'t scoring keys', () => {
    const onAction = vi.fn();
    renderHook(() => useScoringKeys(true, onAction));
    const event = key('q');
    expect(onAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('eliminates with . then a lane, keeping the . through other keys, and forgets it after a few seconds', () => {
    const onAction = vi.fn<(action: ScoringKeyAction) => boolean | void>();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    renderHook(() => useScoringKeys(true, onAction));
    key('.');
    key('Shift');
    key('3');
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'eliminate', lane: 3 });
    key('-');
    now.mockReturnValue(5000);
    key('3');
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'place', lane: 3 });
  });

  it('forgets a . on Escape, and lets Escape through otherwise', () => {
    const onAction = vi.fn();
    renderHook(() => useScoringKeys(true, onAction));
    const plain = key('Escape');
    expect(onAction).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
    key('.');
    const escape = key('Escape');
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'disarm' });
    expect(escape.defaultPrevented).toBe(true);
    key('2');
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'place', lane: 2 });
  });

  it('lets a key through when the screen can\'t act on it, and drops a waiting .', () => {
    const onAction = vi.fn<(action: ScoringKeyAction) => boolean | void>((action) => action.kind !== 'arm' && action.kind !== 'advance');
    const { result } = renderHook(() => useScoringKeys(true, onAction));
    const event = key('ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(result.current).toBe(false);
    key('.');
    key('4');
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'place', lane: 4 });
  });

  it('still works when session storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useScoringKeys(true, vi.fn()));
    expect(result.current).toBe(false);
    key('5');
    expect(result.current).toBe(true);
  });
});
