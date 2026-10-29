import { useCallback } from 'react';
import { useT } from '../../../i18n/LanguageContext';
import { vaccinations } from '../../../i18n/en/vaccinations';
/** Namespaced catalogue contract, with an English fallback during an older cached catalogue update. */
export function useVaccinationT() {
  const translate = useT();
  return useCallback((key: keyof typeof vaccinations): string => {
    const value = (translate as (key: string) => string)(key);
    return value === key ? vaccinations[key] : value;
  }, [translate]);
}
