import { describe, expect, it } from 'vitest';
import { scoringKeyAction, targetKeepsKey, type KeyPress } from './scoringKeys';

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key, ...extra });

describe('scoringKeyAction', () => {
  it('places the lane for 1 to 9 and leaves 0 alone', () => {
    expect(scoringKeyAction(press('1'), false)).toEqual({ action: { kind: 'place', lane: 1 }, armed: false });
    expect(scoringKeyAction(press('9'), false)).toEqual({ action: { kind: 'place', lane: 9 }, armed: false });
    expect(scoringKeyAction(press('0'), false)).toEqual({ action: null, armed: false });
  });

  it('eliminates the lane after . or -', () => {
    for (const key of ['.', '-', ',', 'Decimal', 'Subtract']) {
      expect(scoringKeyAction(press(key), false)).toEqual({ action: { kind: 'arm' }, armed: true });
    }
    expect(scoringKeyAction(press('3'), true)).toEqual({ action: { kind: 'eliminate', lane: 3 }, armed: false });
    // Pressing . again keeps waiting for a lane.
    expect(scoringKeyAction(press('.'), true)).toEqual({ action: { kind: 'arm' }, armed: true });
  });

  it('forgets a waiting . on Escape, and leaves Escape alone otherwise', () => {
    expect(scoringKeyAction(press('Escape'), true)).toEqual({ action: { kind: 'disarm' }, armed: false });
    expect(scoringKeyAction(press('Escape'), false)).toEqual({ action: null, armed: false });
  });

  it('saves on Enter, undoes on Backspace, z, left and Page Up, and moves on with right and Page Down', () => {
    expect(scoringKeyAction(press('Enter'), true)).toEqual({ action: { kind: 'save' }, armed: false });
    for (const key of ['Backspace', 'z', 'Z', 'ArrowLeft', 'PageUp']) {
      expect(scoringKeyAction(press(key), false).action).toEqual({ kind: 'undo' });
    }
    for (const key of ['ArrowRight', 'PageDown']) {
      expect(scoringKeyAction(press(key), false).action).toEqual({ kind: 'advance' });
    }
  });

  it('reads numeric keypad keys by position, so they work with Num Lock off', () => {
    expect(scoringKeyAction(press('ArrowRight', { code: 'Numpad6' }), false).action).toEqual({ kind: 'place', lane: 6 });
    expect(scoringKeyAction(press('Delete', { code: 'NumpadDecimal' }), false).action).toEqual({ kind: 'arm' });
    expect(scoringKeyAction(press('-', { code: 'NumpadSubtract' }), false).action).toEqual({ kind: 'arm' });
    expect(scoringKeyAction(press('Enter', { code: 'NumpadEnter' }), false).action).toEqual({ kind: 'save' });
    expect(scoringKeyAction(press('PageDown', { code: 'PageDown' }), false).action).toEqual({ kind: 'advance' });
  });

  it('ignores shortcuts, repeats, input-method typing and other keys, keeping a waiting .', () => {
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
      expect(scoringKeyAction(press('1', extra), true)).toEqual({ action: null, armed: true });
    }
    expect(scoringKeyAction(press('Shift'), true)).toEqual({ action: null, armed: true });
    expect(scoringKeyAction(press('a'), false)).toEqual({ action: null, armed: false });
  });
});

describe('targetKeepsKey', () => {
  function el(html: string, selector: string): Element {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector(selector)!;
  }

  it('lets nothing through to the scoring keys while typing', () => {
    expect(targetKeepsKey(el('<input>', 'input'), press('1'))).toBe(true);
    expect(targetKeepsKey(el('<textarea></textarea>', 'textarea'), press('Enter'))).toBe(true);
    expect(targetKeepsKey(el('<select></select>', 'select'), press('ArrowRight'))).toBe(true);
    expect(targetKeepsKey({ tagName: 'DIV', isContentEditable: true }, press('z'))).toBe(true);
  });

  it('keeps Enter on buttons and links, but not on a lane card', () => {
    expect(targetKeepsKey(el('<button>Edit this race</button>', 'button'), press('Enter'))).toBe(true);
    expect(targetKeepsKey(el('<a href="/x"><span>x</span></a>', 'span'), press('Enter'))).toBe(true);
    expect(targetKeepsKey(el('<button data-scoring-lane="1">Alpha</button>', 'button'), press('Enter'))).toBe(false);
    expect(targetKeepsKey(el('<button data-scoring-lane="1">Alpha</button>', 'button'), press('Enter', { code: 'NumpadEnter' }))).toBe(false);
    expect(targetKeepsKey(el('<button>Edit</button>', 'button'), press('2'))).toBe(false);
  });

  it('keeps arrows inside tabs and menus', () => {
    expect(targetKeepsKey(el('<div role="tablist"><button role="tab">A</button></div>', 'button'), press('ArrowRight'))).toBe(true);
    expect(targetKeepsKey(el('<div role="tablist"><button role="tab">A</button></div>', 'button'), press('PageDown'))).toBe(false);
    expect(targetKeepsKey(el('<button>A</button>', 'button'), press('ArrowLeft'))).toBe(false);
  });

  it('lets keys through with no target or a bare one', () => {
    expect(targetKeepsKey(null, press('1'))).toBe(false);
    expect(targetKeepsKey(undefined, press('1'))).toBe(false);
    expect(targetKeepsKey({}, press('Enter'))).toBe(false);
    expect(targetKeepsKey(document.body, press('Enter'))).toBe(false);
  });
});
