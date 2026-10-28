import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { loadCatalogue, setActiveLang } from '../i18n/translate';

// Welsh and French load on demand in the app. Most tests render them straight away, so have them ready; the lazy-loading
// tests unload them on purpose.
await loadCatalogue('cy');
await loadCatalogue('fr');

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
