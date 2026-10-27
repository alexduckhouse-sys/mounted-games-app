import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MessageKey } from './en';
import type { MessageValues } from './messages';
import { DEFAULT_LANG, initialLang, localeFor, setActiveLang, storeLang, translate, type Lang, type Translate } from './translate';

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
  const [lang, setLangState] = useState<Lang>(() => {
    const start = initial ?? initialLang();
    setActiveLang(start);
    return start;
  });

  useEffect(() => {
    setActiveLang(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    storeLang(next);
    setActiveLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    locale: localeFor(lang),
    setLang,
    t: (key, values) => translate(lang, key, values),
  }), [lang, setLang]);

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
