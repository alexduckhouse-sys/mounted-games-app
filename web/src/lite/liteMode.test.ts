import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionReason, liteStatusText, readSetting, resolveLite, writeSetting, type ConnectionLike } from './liteMode';
import { installConnection, removeConnection } from '../test/lite';

afterEach(removeConnection);

const reading = (init: Partial<ConnectionLike>) => Object.assign(new EventTarget(), init) as ConnectionLike;

describe('connectionReason', () => {
  it('says nothing when the browser has no connection API (iPhone Safari)', () => {
    removeConnection();
    expect(connectionReason()).toBeNull();
  });

  it('reads navigator.connection by default', () => {
    installConnection({ saveData: true });
    expect(connectionReason()).toBe('data-saver');
  });

  it('treats Data Saver as a reason, even on a fast connection', () => {
    expect(connectionReason(reading({ saveData: true, effectiveType: '4g', rtt: 50 }))).toBe('data-saver');
  });

  it.each(['slow-2g', '2g'])('treats %s as slow', (effectiveType) => {
    expect(connectionReason(reading({ effectiveType }))).toBe('slow-connection');
  });

  it('treats 3g as slow only when the round trip is over 600 ms', () => {
    expect(connectionReason(reading({ effectiveType: '3g', rtt: 601 }))).toBe('slow-connection');
    expect(connectionReason(reading({ effectiveType: '3g', rtt: 600 }))).toBeNull();
    expect(connectionReason(reading({ effectiveType: '3g' }))).toBeNull();
  });

  it('leaves 4g and empty readings alone', () => {
    expect(connectionReason(reading({ effectiveType: '4g', rtt: 900, saveData: false }))).toBeNull();
    expect(connectionReason(reading({}))).toBeNull();
  });
});

describe('resolveLite', () => {
  it('lets On and Off override the connection', () => {
    expect(resolveLite('on', null)).toEqual({ lite: true, reason: 'chosen' });
    expect(resolveLite('off', 'slow-connection')).toEqual({ lite: false, reason: null });
  });

  it('lets Auto follow the connection', () => {
    expect(resolveLite('auto', 'data-saver')).toEqual({ lite: true, reason: 'data-saver' });
    expect(resolveLite('auto', null)).toEqual({ lite: false, reason: null });
  });
});

describe('saved setting', () => {
  it('defaults to Auto', () => {
    expect(readSetting()).toBe('auto');
  });

  it('round-trips each setting', () => {
    for (const setting of ['on', 'off', 'auto'] as const) {
      writeSetting(setting);
      expect(readSetting()).toBe(setting);
    }
  });

  it.each(['', 'ON', 'lite', 'null'])('ignores the unknown saved value %j', (saved) => {
    localStorage.setItem('mg.liteMode', saved);
    expect(readSetting()).toBe('auto');
  });

  it('copes with storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSetting()).toBe('auto');
    expect(() => writeSetting('on')).not.toThrow();
  });
});

describe('liteStatusText', () => {
  it('says why in plain words', () => {
    expect(liteStatusText(false, null)).toBe('Off');
    expect(liteStatusText(true, 'slow-connection')).toBe('On because your connection is slow');
    expect(liteStatusText(true, 'data-saver')).toBe('On because Data Saver is on');
    expect(liteStatusText(true, 'chosen')).toBe('On because you chose it');
    expect(liteStatusText(true, null)).toBe('On because you chose it');
  });
});
