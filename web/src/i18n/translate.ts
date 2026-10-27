import { cy } from './cy/index.ts';
import { en, type Catalogue, type MessageKey } from './en/index.ts';
import { fr } from './fr/index.ts';
import type { Message, MessageValues, PluralForms } from './messages.ts';

/** The languages people can pick, each named in itself. English is the source and the fallback. */
export const LANGUAGES = [
  { id: 'en', name: 'English', locale: 'en-GB' },
  { id: 'cy', name: 'Cymraeg', locale: 'cy-GB' },
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['id'];

export const DEFAULT_LANG: Lang = 'en';
export const LANG_KEY = 'mg.lang';

const CATALOGUES: Record<Lang, Catalogue> = { en, cy, fr };

export function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((language) => language.id === value);
}

/** The locale used for dates and numbers in a language. */
export function localeFor(lang: Lang): string {
  return LANGUAGES.find((language) => language.id === lang)!.locale;
}

/** Maps a browser language such as `cy`, `fr-CA` or `en-US` to one of ours; anything else is English. */
export function langFromBrowser(tag: string | null | undefined): Lang {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : DEFAULT_LANG;
}

export function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return isLang(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Private browsing or full storage: the choice still applies until the page is closed.
  }
}

/**
 * The language the person picked, or the browser's language until they pick one. Following the browser is not
 * stored, so changing the phone's language changes the app too; only an explicit choice sticks.
 */
export function initialLang(): Lang {
  return readStoredLang() ?? langFromBrowser(typeof navigator === 'undefined' ? null : navigator.language);
}

// The language in use, for helpers outside React (date formatting in lib/). The provider keeps it current.
let activeLang: Lang = DEFAULT_LANG;

export function setActiveLang(lang: Lang): void {
  activeLang = lang;
}

export function getActiveLang(): Lang {
  return activeLang;
}

/** `en-GB`, `cy-GB` or `fr-FR`, for `toLocaleDateString` and friends. */
export function activeLocale(): string {
  return localeFor(activeLang);
}

function interpolate(text: string, values?: MessageValues): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

function pluralText(forms: PluralForms, lang: Lang, values?: MessageValues): string {
  const count = Number(values?.count ?? 0);
  const category = new Intl.PluralRules(localeFor(lang)).select(count) as keyof PluralForms;
  // An exact zero reads better as "No teams" in every language when a zero form is given.
  if (count === 0 && forms.zero) return forms.zero;
  return forms[category] ?? forms.other;
}

function usable(message: Message | undefined): message is Message {
  if (typeof message === 'string') return message.length > 0;
  return message != null && typeof message.other === 'string' && message.other.length > 0;
}

/** Looks a key up in the language's catalogue, falling back to English for anything missing. */
export function translate(lang: Lang, key: MessageKey, values?: MessageValues): string {
  const own: Message | undefined = CATALOGUES[lang]?.[key];
  const fallback: Message | undefined = en[key];
  // English is complete by construction (the key type comes from it). If a key somehow has no text anywhere,
  // show nothing rather than the raw key.
  const [message, from] = usable(own) ? [own, lang] : usable(fallback) ? [fallback, DEFAULT_LANG] : [undefined, DEFAULT_LANG];
  if (message === undefined) return '';
  return formatMessage(message, from, values);
}

/** Picks the plural form (for plural messages) and fills in the `{placeholders}`. */
export function formatMessage(message: Message, lang: Lang, values?: MessageValues): string {
  const text = typeof message === 'string' ? message : pluralText(message, lang, values);
  return interpolate(text, values);
}

/**
 * `translate` in the language currently in use, for code that is not a React component or runs outside the
 * provider (helpers in lib/, dialogs opened with their own React root).
 */
export function tr(key: MessageKey, values?: MessageValues): string {
  return translate(activeLang, key, values);
}

export type Translate = (key: MessageKey, values?: MessageValues) => string;
