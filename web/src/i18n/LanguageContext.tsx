import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MessageKey } from './en';
import type { MessageValues } from './messages';
import { DEFAULT_LANG, initialLang, isLoaded, loadCatalogue, localeFor, setActiveLang, storeLang, translate, type Lang, type Translate } from './translate';

interface LanguageContextValue {
  lang: Lang;
  /** `en-GB`, `cy-GB` or `fr-FR`. */
  locale: string;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const englishT: Translate = (key: MessageKey, values?: MessageValues) => translate(DEFAULT_LANG, key, values);

// Outside the provider (unit tests that render one component) everything reads in English.
const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  locale: localeFor(DEFAULT_LANG),
  setLang: () => {},
  t: englishT,
});

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());
  // Bumped when a catalogue arrives, so the text re-renders in the chosen language.
  const [arrived, setArrived] = useState(0);

  // Until the chosen catalogue has loaded the app reads in English, never blank and never raw keys.
  const shown: Lang = isLoaded(lang) ? lang : DEFAULT_LANG;
  setActiveLang(shown);

  useEffect(() => {
    if (isLoaded(lang)) return;
    let current = true;
    void loadCatalogue(lang).then((ok) => {
      if (ok && current) setArrived((count) => count + 1);
    });
    return () => { current = false; };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = shown;
  }, [shown]);

  const setLang = useCallback((next: Lang) => {
    storeLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    locale: localeFor(shown),
    setLang,
    t: (key, values) => translate(shown, key, values),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `arrived` marks a catalogue landing; `shown` already reflects it
  }), [lang, shown, setLang, arrived]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The chosen language, its locale and a setter. */
// eslint-disable-next-line react-refresh/only-export-components -- hook lives beside its provider by design
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** `t('nav.events')` or `t('teams.count', { count: 3 })` in the chosen language. */
// eslint-disable-next-line react-refresh/only-export-components -- hook lives beside its provider by design
export function useT(): Translate {
  return useContext(LanguageContext).t;
}
