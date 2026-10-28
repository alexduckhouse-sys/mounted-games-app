import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ConnectionInputs } from './connectionStatus';

/** Published by the competition page so the header can show the connection pill. */
export interface ConnectionStatus extends ConnectionInputs {
  /** How often the page checks for changes while the live link is down. */
  intervalMs: number;
  /** A check is running because the user asked for one. */
  retrying: boolean;
  /** Check for changes and try the live link again now. */
  retry: () => void;
}

interface State { status: ConnectionStatus | null; setStatus: (status: ConnectionStatus | null) => void }
const Ctx = createContext<State | null>(null);

export function ConnectionStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const value = useMemo(() => ({ status, setStatus }), [status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The provider and its hook deliberately share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useConnectionStatus() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConnectionStatus must be used within ConnectionStatusProvider');
  return ctx;
}

/** The same as `useConnectionStatus`, but null outside the provider (for parts that also render outside the app shell). */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalConnectionStatus() {
  return useContext(Ctx);
}
