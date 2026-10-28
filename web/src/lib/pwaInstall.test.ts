import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice, resetDevice, UA } from '../test/device';
import { installWay, isAndroid, isIosDevice, isIosSafari, isStandalone, needsHomeScreenForPush } from './pwaInstall';

afterEach(resetDevice);

const ua = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

describe('isIosDevice', () => {
  it('spots iPhones, and iPads asking for desktop pages by their touch screen', () => {
    expect(isIosDevice(ua(UA.iphoneSafari))).toBe(true);
    expect(isIosDevice(ua(UA.iphoneChrome))).toBe(true);
    expect(isIosDevice(ua(UA.ipadDesktop, 5))).toBe(true);
    expect(isIosDevice(ua('Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)'))).toBe(true);
  });

  it('leaves Macs, Android and Windows alone', () => {
    expect(isIosDevice(ua(UA.macSafari, 0))).toBe(false);
    expect(isIosDevice(ua(UA.android))).toBe(false);
    expect(isIosDevice(ua(UA.desktopChrome))).toBe(false);
  });

  it('reads the real navigator when not given one', () => {
    fakeDevice({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 });
    expect(isIosDevice()).toBe(true);
  });

  it('copes with a navigator that lacks the details', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(undefined as unknown as string);
    expect(isIosDevice()).toBe(false);
  });

  it('says no where there is no navigator at all', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isIosDevice()).toBe(false);
  });
});

describe('isIosSafari', () => {
  it('is true for Safari on an iPhone or iPad', () => {
    expect(isIosSafari(ua(UA.iphoneSafari))).toBe(true);
    expect(isIosSafari(ua(UA.ipadDesktop, 5))).toBe(true);
  });

  it('is false for Chrome on iOS and in-app browsers', () => {
    expect(isIosSafari(ua(UA.iphoneChrome))).toBe(false);
    expect(isIosSafari(ua(UA.iphoneInstagram))).toBe(false);
    expect(isIosSafari(ua(UA.iphoneFacebook))).toBe(false);
  });

  it('is false off iOS, Mac Safari included', () => {
    expect(isIosSafari(ua(UA.macSafari))).toBe(false);
    expect(isIosSafari(ua(UA.android))).toBe(false);
  });

  it('reads the real navigator when not given one', () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    expect(isIosSafari()).toBe(true);
  });
});

describe('isAndroid', () => {
  it('spots Android', () => {
    expect(isAndroid(ua(UA.android))).toBe(true);
    expect(isAndroid(ua(UA.iphoneSafari))).toBe(false);
    fakeDevice({ userAgent: UA.android });
    expect(isAndroid()).toBe(true);
  });
});

describe('isStandalone', () => {
  it('is true when the display mode is standalone', () => {
    fakeDevice({ userAgent: UA.android, displayStandalone: true });
    expect(isStandalone()).toBe(true);
  });

  it('is true when Safari says it was opened from the Home Screen', () => {
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: true });
    expect(isStandalone()).toBe(true);
  });

  it('is false in a browser tab', () => {
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: false });
    expect(isStandalone()).toBe(false);
  });

  it('is false without matchMedia, and when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isStandalone()).toBe(false);
    vi.stubGlobal('matchMedia', () => { throw new Error('unsupported query'); });
    expect(isStandalone()).toBe(false);
  });

  it('is false where there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(isStandalone()).toBe(false);
  });
});

describe('needsHomeScreenForPush', () => {
  it('is true for an iPhone in Safari, false once installed or off iOS', () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    expect(needsHomeScreenForPush()).toBe(true);
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: true });
    expect(needsHomeScreenForPush()).toBe(false);
    fakeDevice({ userAgent: UA.android });
    expect(needsHomeScreenForPush()).toBe(false);
    expect(needsHomeScreenForPush(ua(UA.iphoneChrome))).toBe(true);
  });
});

describe('installWay', () => {
  const none = { installed: false, canPrompt: false };

  it('is installed once installed or running standalone', () => {
    fakeDevice({ userAgent: UA.android });
    expect(installWay({ installed: true, canPrompt: true })).toBe('installed');
    fakeDevice({ userAgent: UA.android, displayStandalone: true });
    expect(installWay(none)).toBe('installed');
  });

  it('uses the browser prompt when there is one', () => {
    fakeDevice({ userAgent: UA.android });
    expect(installWay({ installed: false, canPrompt: true })).toBe('prompt');
  });

  it('tells Safari on iOS from other iOS browsers', () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    expect(installWay(none)).toBe('ios-safari');
    expect(installWay(none, ua(UA.iphoneInstagram))).toBe('ios-other');
  });

  it('offers nothing elsewhere', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    expect(installWay(none)).toBe('none');
  });
});
