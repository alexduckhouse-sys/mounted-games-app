import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage, useT } from './LanguageContext';
import { activeLocale, isLoaded, LANG_KEY, loadCatalogue, tr, unloadCatalogueForTests } from './translate';

function Probe() {
  const { lang, setLang } = useLanguage();
  const t = useT();
  return (
    <div>
      <p data-testid="back">{t('common.back')}</p>
      <p data-testid="lang">{lang}</p>
      <button onClick={() => setLang('cy')}>cy</button>
    </div>
  );
}

beforeEach(() => {
  unloadCatalogueForTests('cy');
  unloadCatalogueForTests('fr');
});

afterEach(async () => {
  await loadCatalogue('cy');
  await loadCatalogue('fr');
});

describe('lazy Welsh and French catalogues', () => {
  it('keeps English available without loading anything', () => {
    expect(isLoaded('en')).toBe(true);
    expect(isLoaded('cy')).toBe(false);
    expect(tr('common.back')).toBe('Back');
  });

  it('loads Welsh when the person switches to it, staying in English until it arrives', async () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    act(() => { screen.getByText('cy').click(); });
    expect(screen.getByTestId('lang')).toHaveTextContent('cy');
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    expect(localStorage.getItem(LANG_KEY)).toBe('cy');
    expect(await screen.findByText('Yn ôl')).toBeInTheDocument();
    expect(isLoaded('cy')).toBe(true);
    expect(isLoaded('fr')).toBe(false);
    expect(tr('common.back')).toBe('Yn ôl');
    // The page language is set in an effect after the text changes, so wait for it rather than race it.
    await waitFor(() => expect(document.documentElement.lang).toBe('cy'));
    expect(activeLocale()).toBe('cy-GB');
  });

  it('starts with a stored French choice in English, then switches to French once it arrives', async () => {
    localStorage.setItem(LANG_KEY, 'fr');
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    expect(document.documentElement.lang).toBe('en');
    expect(await screen.findByText('Retour')).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe('fr'));
  });

  it('shares one request between repeat calls', async () => {
    const [a, b] = await Promise.all([loadCatalogue('fr'), loadCatalogue('fr')]);
    expect(a && b).toBe(true);
  });
});
