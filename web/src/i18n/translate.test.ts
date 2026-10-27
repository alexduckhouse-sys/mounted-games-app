import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeLocale, DEFAULT_LANG, getActiveLang, initialLang, isLang, langFromBrowser, LANG_KEY, localeFor, readStoredLang, setActiveLang, storeLang, tr, translate,
} from './translate';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('languages', () => {
  it('recognises our three and nothing else', () => {
    expect(['en', 'cy', 'fr'].every(isLang)).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('maps browser tags to a language, English for anything else', () => {
    expect(langFromBrowser('cy')).toBe('cy');
    expect(langFromBrowser('cy-GB')).toBe('cy');
    expect(langFromBrowser('FR-ca')).toBe('fr');
    expect(langFromBrowser('fr_FR')).toBe('fr');
    expect(langFromBrowser('en-US')).toBe('en');
    expect(langFromBrowser('de-DE')).toBe('en');
    expect(langFromBrowser('')).toBe('en');
    expect(langFromBrowser(null)).toBe('en');
    expect(langFromBrowser(undefined)).toBe('en');
  });

  it('gives each language a locale', () => {
    expect(localeFor('en')).toBe('en-GB');
    expect(localeFor('cy')).toBe('cy-GB');
    expect(localeFor('fr')).toBe('fr-FR');
  });
});

describe('storage', () => {
  it('starts from the browser language (en-US in jsdom is English) and does not store it', () => {
    expect(initialLang()).toBe('en');
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
  });

  it('follows the browser on a first visit', () => {
    vi.stubGlobal('navigator', { language: 'cy-GB' });
    expect(initialLang()).toBe('cy');
  });

  it('prefers a stored choice over the browser', () => {
    vi.stubGlobal('navigator', { language: 'cy-GB' });
    storeLang('fr');
    expect(readStoredLang()).toBe('fr');
    expect(initialLang()).toBe('fr');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(LANG_KEY, 'klingon');
    expect(readStoredLang()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readStoredLang()).toBeNull();
    expect(() => storeLang('cy')).not.toThrow();
    expect(initialLang()).toBe('en');
  });

  it('falls back to English when there is no navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(initialLang()).toBe('en');
  });
});

describe('translate', () => {
  it('reads English by default and in the other languages', () => {
    expect(translate('en', 'common.back')).toBe('Back');
    expect(translate('cy', 'common.back')).not.toBe('');
    expect(translate('fr', 'common.back')).toBe('Retour');
  });

  it('tracks the active language for helpers outside React', () => {
    expect(getActiveLang()).toBe(DEFAULT_LANG);
    expect(activeLocale()).toBe('en-GB');
    setActiveLang('fr');
    expect(tr('common.back')).toBe('Retour');
    expect(activeLocale()).toBe('fr-FR');
  });

  it('shows nothing, never the raw key, for a key with no text anywhere', () => {
    expect(translate('cy', 'no.such.key' as never)).toBe('');
  });
});
