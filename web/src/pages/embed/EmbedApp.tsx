import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { LanguageProvider, useT } from '../../i18n/LanguageContext';
import { langFromBrowser } from '../../i18n/translate';
import { parseEmbedOptions } from '../../lib/embed';
import { CompetitionEmbed } from './CompetitionEmbed';
import { EmbedFrame, EmbedMessage } from './EmbedFrame';
import { SeasonEmbed } from './SeasonEmbed';
import { BroadcastOverlay } from './BroadcastOverlay';

function NotAvailable() {
  const t = useT();
  const [search] = useSearchParams();
  const options = useMemo(() => parseEmbedOptions(search), [search]);
  return <EmbedFrame title={t('common.mountedGames')} options={options} homeHref="/"><EmbedMessage>{t('screen.embed.widgetGone')}</EmbedMessage></EmbedFrame>;
}

/**
 * The whole app for /embed/ pages. It is a separate tree from `App` on purpose: no sign-in, theme, saved
 * competition, offline copies or navigation, so the frame cannot read or change anything of the visitor's.
 * Unknown /embed/ paths show a message and never redirect, which would leave the framed document on a page
 * that must not be framed.
 *
 * The words follow the visitor's browser language, never the app's stored choice: the frame reads no storage.
 */
export function EmbedApp() {
  return (
    <LanguageProvider initial={langFromBrowser(typeof navigator === 'undefined' ? null : navigator.language)}>
    <BrowserRouter>
      <Routes>
        <Route path="/embed/competitions/:id/overlay" element={<BroadcastOverlay />} />
        <Route path="/embed/competitions/:id/standings" element={<CompetitionEmbed view="standings" />} />
        <Route path="/embed/competitions/:id/results" element={<CompetitionEmbed view="results" />} />
        <Route path="/embed/competitions/:id/timetable" element={<CompetitionEmbed view="timetable" />} />
        <Route path="/embed/seasons/:seasonId/standings" element={<SeasonEmbed />} />
        <Route path="*" element={<NotAvailable />} />
      </Routes>
    </BrowserRouter>
    </LanguageProvider>
  );
}
