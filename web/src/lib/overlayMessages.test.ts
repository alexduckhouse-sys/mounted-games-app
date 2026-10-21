import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMessages, writeMessages } from './overlayMessages';

afterEach(() => { vi.restoreAllMocks(); });

describe('saved banner messages', () => {
  it('round-trips per competition', () => {
    writeMessages(1, [{ text: 'Lunch until 1pm', style: 1 }]);
    expect(readMessages(1)).toEqual([{ text: 'Lunch until 1pm', style: 1 }]);
    expect(readMessages(2)).toEqual([]);
  });

  it('drops anything malformed', () => {
    localStorage.setItem('mg.overlay.messages.1', JSON.stringify([{ text: 'ok', style: 2 }, { text: 3, style: 0 }, { text: 'x', style: 9 }, null]));
    expect(readMessages(1)).toEqual([{ text: 'ok', style: 2 }]);
    localStorage.setItem('mg.overlay.messages.1', '{"not":"a list"}');
    expect(readMessages(1)).toEqual([]);
    localStorage.setItem('mg.overlay.messages.1', 'not json');
    expect(readMessages(1)).toEqual([]);
  });

  it('copes with blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writeMessages(1, [{ text: 'x', style: 0 }])).not.toThrow();
  });
});
