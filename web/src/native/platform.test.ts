import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isIosApp, isNativeApp } from './platform';

const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn(), getPlatform: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }));

beforeEach(() => {
  capacitor.isNativePlatform.mockReturnValue(false);
  capacitor.getPlatform.mockReturnValue('web');
});

describe('isNativeApp', () => {
  it('is false in a browser', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is true inside the app', () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    expect(isNativeApp()).toBe(true);
  });

  it('is false if the runtime cannot answer', () => {
    capacitor.isNativePlatform.mockImplementation(() => { throw new Error('no bridge'); });
    expect(isNativeApp()).toBe(false);
  });
});

describe('isIosApp', () => {
  it('is true only in the native iOS app', () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    capacitor.getPlatform.mockReturnValue('ios');
    expect(isIosApp()).toBe(true);
  });

  it('is false in the Android app', () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    capacitor.getPlatform.mockReturnValue('android');
    expect(isIosApp()).toBe(false);
  });

  it('is false in a browser on an iPhone', () => {
    capacitor.getPlatform.mockReturnValue('ios');
    expect(isIosApp()).toBe(false);
  });
});
