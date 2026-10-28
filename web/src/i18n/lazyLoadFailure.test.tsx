import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage, useT } from './LanguageContext';
import { isLoaded, loadCatalogue, tr, unloadCatalogueForTests } from './translate';

// The Welsh chunk fails to load (offline, or a stale chunk after a deploy).
vi.mock('./cy/index.ts', () => { throw new Error('Failed to fetch dynamically imported module'); });

function Probe() {
  const { setLang } = useLanguage();
  const t = useT();
  return (
    <div>
      <p data-testid="back">{t('common.back')}</p>
      <button onClick={() => setLang('cy')}>cy</button>
    </div>
  );
}

describe('a failed catalogue load', () => {
  // The shared test setup preloads Welsh before this file's mock applies.
  beforeEach(() => unloadCatalogueForTests('cy'));

  it('stays in English instead of breaking, and reports the failure', async () => {
    expect(await loadCatalogue('cy')).toBe(false);
    render(<LanguageProvider><Probe /></LanguageProvider>);
    act(() => { screen.getByText('cy').click(); });
    await act(async () => { await loadCatalogue('cy'); });
    expect(isLoaded('cy')).toBe(false);
    expect(screen.getByTestId('back')).toHaveTextContent('Back');
    expect(tr('common.back')).toBe('Back');
  });
});
