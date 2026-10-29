import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Barlow and Barlow Condensed set the EGUK look across the app; bundled (Latin only) so they're precached and work offline.
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './index.css'
import './theme/skin.css'
import './theme/flat.css'
import './theme/laptop.css'
import './theme/kit.css'
import App from './App.tsx'
import { registerPwa } from './pwa'
import { startOutboxSync } from './offline/useScoreOutbox'
import { isEmbedPath } from './lib/embed'
import { listenForInstall } from './hooks/usePwaInstall'

const root = createRoot(document.getElementById('root')!)

if (isEmbedPath(window.location.pathname)) {
  // Browser sources must remain transparent while their code/data is still loading.
  if (/^\/embed\/competitions\/\d+\/overlay\/?$/.test(window.location.pathname)) {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.getElementById('root')!.style.background = 'transparent';
  }
  // The widget on a club's site is its own small app. It must not read the visitor's sign-in, saved
  // settings or caches, so it skips the providers, the service worker and the score outbox entirely.
  void import('./pages/embed/EmbedApp').then(({ EmbedApp }) => root.render(
    <StrictMode>
      <EmbedApp />
    </StrictMode>,
  ))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  registerPwa();
  // Chromium offers its install prompt once, early; keep it for the Install button in Settings.
  listenForInstall();
  startOutboxSync();
}
