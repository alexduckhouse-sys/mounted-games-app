import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { loadCatalogue, setActiveLang } from '../i18n/translate';

// Welsh and French load on demand in the app. Most tests render them straight away, so have them ready; the lazy-loading
// tests unload them on purpose.
await loadCatalogue('cy');
await loadCatalogue('fr');

// findBy*/waitFor give up after 1 s by default. That is plenty on a quiet machine, but the first render in a file is cold
// (jsdom, role and accessible-name queries over a whole page) and when the CPU is shared, a full run, CI or another agent's
// build, one second is not enough for a page that is working. Keep it well inside the 15 s test timeout set in
// vitest.config.ts. Tests that wait for something that never comes still fail, only a little later.
configure({ asyncUtilTimeout: 5_000 });

// A few files opt into the node environment (service-worker helpers), where there is no DOM to reset.
if (typeof window !== 'undefined') {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    for (const cookie of document.cookie.split('; ').filter(Boolean)) {
      document.cookie = `${cookie.split('=')[0]}=; Max-Age=0; Path=/`;
    }
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.lang = 'en';
    setActiveLang('en');
  });

  // jsdom does not implement the modal <dialog> API.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
}
