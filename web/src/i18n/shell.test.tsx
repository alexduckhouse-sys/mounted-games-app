import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BottomTabs } from '../components/BottomTabs';
import { GlobalTabs } from '../components/GlobalTabs';
import { Notice } from '../components/Notice';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PrivacyPage } from '../pages/PrivacyPage';
import { tickerItems } from '../lib/ticker';
import { tabCountFlag } from '../lib/settingsEdit';
import { lastUpdatedText } from '../offline/savedCopies';
import { liteStatusText } from '../lite/liteMode';
import { formatTime } from '../lib/time';
import { competitionDateText } from '../lib/competitionDates';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { setActiveLang } from './translate';
import { heat as baseHeat, session as baseSession } from '../test/factories';

const wrap = (initial: 'cy' | 'fr', ui: React.ReactNode, path = '/') => render(
  <LanguageProvider initial={initial}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></LanguageProvider>,
);

describe('shell in Welsh and French', () => {
  it('translates the competition tabs but keeps their addresses', () => {
    wrap('cy', <BottomTabs competitionId={12} />, '/competitions/12');
    expect(screen.getByRole('navigation', { name: 'Cystadleuaeth' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Amserlen', '/competitions/12'],
      ['Safleoedd', '/competitions/12/toplists'],
      ['Ffrwd fyw', '/competitions/12/chat'],
      ['Manylion', '/competitions/12/details'],
    ]);
  });

  it('translates the entry-only tabs and the Me tab count in French', () => {
    wrap('fr', <BottomTabs competitionId={12} entryOnly me={{ initials: 'AB', count: 2 }} />, '/competitions/12');
    expect(screen.getByRole('link', { name: 'Inscription' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Moi/ })).toHaveTextContent('Moi, 2 à faire');
  });

  it('translates the global tabs', () => {
    wrap('fr', <CurrentCompetitionProvider><GlobalTabs meCount={1} /></CurrentCompetitionProvider>, '/events');
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Événements', 'Suivis', '1Moi, 1 à faire']);
  });

  it('translates the not found page', () => {
    wrap('cy', <NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Heb ddod o hyd i’r dudalen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gweld cystadlaethau' })).toHaveAttribute('href', '/events');
  });

  it('translates a notice’s default dismiss label', () => {
    wrap('fr', <Notice onDismiss={() => {}}>Bonjour</Notice>);
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    expect(screen.getByText('Bonjour')).toBeInTheDocument();
  });

  it('keeps the legal text in English and says so in the chosen language', () => {
    wrap('cy', <PrivacyPage />, '/privacy');
    expect(screen.getByText('Mae’r testun cyfreithiol ar y tudalennau hyn yn Saesneg yn unig.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy and data protection (UK GDPR)' })).toHaveAttribute('lang', 'en');
  });

  it('shows no language note on the English legal page', () => {
    render(<LanguageProvider initial="en"><MemoryRouter initialEntries={['/privacy']}><PrivacyPage /></MemoryRouter></LanguageProvider>);
    expect(screen.queryByText(/Saesneg|anglais/)).not.toBeInTheDocument();
  });

  it('switches the language of a mounted page without a reload', () => {
    function Picker() {
      const { setLang } = useLanguage();
      return <button onClick={() => setLang('cy')}>cymraeg</button>;
    }
    render(<LanguageProvider initial="en"><MemoryRouter><NotFoundPage /><Picker /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByText('cymraeg')); });
    expect(screen.getByRole('heading', { name: 'Heb ddod o hyd i’r dudalen' })).toBeInTheDocument();
  });
});

describe('helpers outside React in Welsh and French', () => {
  const now = new Date('2026-06-01T10:00:00Z');
  const heat = (id: number) => baseHeat(id, { label: 'Heat 1' });
  const live = [baseSession(1, { name: 'Seniors', sectionName: 'Teams Seniors', heats: [heat(1)], status: 1 })];

  it('words the ticker in the chosen language and keeps data as given', () => {
    setActiveLang('fr');
    expect(tickerItems(live, [], now)[0].text).toBe('En cours : Seniors Session 1 · Heat 1');
    setActiveLang('cy');
    expect(tickerItems(live, [], now)[0].text).toBe('Nawr: Seniors Session 1 · Heat 1');
  });

  it('says on time and finished in the chosen language', () => {
    setActiveLang('cy');
    expect(tickerItems(live, [], now).map((item) => item.text)).toContain('Ar amser');
    setActiveLang('fr');
    expect(tickerItems(live, [], now).map((item) => item.text)).toContain('À l’heure');
  });

  it('lists the usual tabs with the locale’s own “and”', () => {
    setActiveLang('fr');
    expect(tabCountFlag(1)).toBe('Choisissez au moins 2 onglets. Avec moins, la barre du bas affiche Horaires, Classements, Direct et Infos.');
    setActiveLang('cy');
    expect(tabCountFlag(1)).toContain('Amserlen');
    expect(tabCountFlag(9)).toContain('6');
  });

  it('words saved-copy ages, lite mode status and dates in the chosen language', () => {
    setActiveLang('fr');
    expect(lastUpdatedText(null)).toBe('Dernière mise à jour plus tôt');
    expect(lastUpdatedText(now.toISOString(), now)).toMatch(/^Dernière mise à jour à \d\d:\d\d$/);
    expect(lastUpdatedText('2026-05-20T10:00:00Z', now)).toMatch(/^Dernière mise à jour le .+, à \d\d:\d\d$/);
    expect(liteStatusText(true, 'slow-connection')).toBe('Activé car votre connexion est lente');
    expect(competitionDateText('2026-10-17T09:00:00Z')).toMatch(/oct/i);
    expect(formatTime(new Date('2026-06-01T09:05:00'))).toMatch(/09[:h]05/);
    setActiveLang('cy');
    expect(lastUpdatedText(null)).toBe('Diweddarwyd ddiwethaf yn gynharach');
    expect(competitionDateText('2026-10-17T09:00:00Z')).toMatch(/Hyd/);
  });
});
