import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter ships with the app (Latin only) so it's precached and works offline.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
// Barlow and Barlow Condensed set the EGUK look on the public pages; bundled for the same offline reason.
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './index.css'
import './theme/skin.css'
import App from './App.tsx'
import { registerPwa } from './pwa'
import { startOutboxSync } from './offline/useScoreOutbox'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerPwa();
startOutboxSync();
