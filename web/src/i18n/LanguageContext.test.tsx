import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage, useT } from './LanguageContext';
import { activeLocale, LANG_KEY } from './translate';

function Probe() {
  const { lang, locale, setLang } = useLanguage();
  const t = useT();
  return (
    <div>
      <p data-testid="back">{t('common.back')}</p>
      <p data-testid="lang">{lang} {locale}</p>
      <button onClick={() => setLang('cy')}>cy</button>
      <button onClick={() => setLang('fr')}>fr</button>
    </div>
  );
}

describe('LanguageContext', () => {
  it('reads English with no provider, so unit tests of single components keep seeing English', () => {
    render(<Probe />);
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    expect(screen.getByTestId('lang')).toHaveTextContent('en en-GB');
    act(() => { screen.getByText('fr').click(); });
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
  });

  it('starts in English for an English browser and sets the html lang', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    expect(document.documentElement.lang).toBe('en');
  });

  it('follows a Welsh browser on a first visit without storing it', () => {
    vi.stubGlobal('navigator', { language: 'cy-GB' });
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('cy cy-GB');
    expect(document.documentElement.lang).toBe('cy');
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
  });

  it('switches language, remembers the choice and updates the locale used by date helpers', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    act(() => { screen.getByText('fr').click(); });
    expect(screen.getByTestId('back')).toHaveTextContent('Retour');
    expect(screen.getByTestId('lang')).toHaveTextContent('fr fr-FR');
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem(LANG_KEY)).toBe('fr');
    expect(activeLocale()).toBe('fr-FR');
  });

  it('takes an initial language from its prop', () => {
    render(<LanguageProvider initial="cy"><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('cy cy-GB');
  });

  it('still switches when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<LanguageProvider><Probe /></LanguageProvider>);
    act(() => { screen.getByText('cy').click(); });
    expect(screen.getByTestId('lang')).toHaveTextContent('cy cy-GB');
  });
});
