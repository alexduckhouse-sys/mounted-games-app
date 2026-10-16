import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
  });

  // jsdom does not implement the modal <dialog> API.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
}
