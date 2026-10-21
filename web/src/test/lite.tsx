import type { ReactNode } from 'react';
import { LiteModeProvider } from '../lite/LiteModeContext';
import type { LiteSetting } from '../lite/liteMode';

interface Reading { saveData?: boolean; effectiveType?: string; rtt?: number }

/** A stand-in for `navigator.connection` that can announce changes. */
export class FakeConnection extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  rtt?: number;
  constructor(init: Reading = {}) {
    super();
    Object.assign(this, init);
  }
  /** Changes the reading and fires the `change` event, as a browser does. */
  update(patch: Reading) {
    Object.assign(this, patch);
    this.dispatchEvent(new Event('change'));
  }
}

export function installConnection(init: Reading = {}) {
  const connection = new FakeConnection(init);
  Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  return connection;
}

/** jsdom has no `navigator.connection`, which is also how iPhone Safari looks. */
export function removeConnection() {
  delete (navigator as unknown as Record<string, unknown>).connection;
}

/** Wraps children in the lite-mode provider. Pass a setting to start from a saved choice. */
export function liteWrapper(setting?: LiteSetting) {
  if (setting) localStorage.setItem('mg.liteMode', setting);
  return function Wrapper({ children }: { children: ReactNode }) { return <LiteModeProvider>{children}</LiteModeProvider>; };
}
