import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { connectionReason, getConnection, readSetting, resolveLite, writeSetting, type AutoReason, type LiteReason, type LiteSetting } from './liteMode';

export interface LiteModeValue {
  /** True when the app should hold back images, weather, video and animation. */
  lite: boolean;
  setting: LiteSetting;
  setSetting: (setting: LiteSetting) => void;
  /** Why lite mode is on, or null while it is off. */
  reason: LiteReason | null;
}

// Components outside the provider (tests, print pages) simply get normal mode.
const LiteModeContext = createContext<LiteModeValue>({ lite: false, setting: 'auto', setSetting: () => {}, reason: null });

function subscribeToConnection(onChange: () => void) {
  const connection = getConnection();
  connection?.addEventListener('change', onChange);
  return () => connection?.removeEventListener('change', onChange);
}
// A string (not an object) so React sees a stable snapshot between changes.
const connectionSnapshot = () => connectionReason() ?? '';

export function LiteModeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<LiteSetting>(readSetting);
  const auto = useSyncExternalStore(subscribeToConnection, connectionSnapshot, () => '');
  const { lite, reason } = resolveLite(setting, (auto || null) as AutoReason | null);

  const setSetting = useCallback((next: LiteSetting) => {
    setSettingState(next);
    writeSetting(next);
  }, []);

  // Lets the stylesheet switch off CSS animations and transitions too.
  useEffect(() => {
    if (!lite) return;
    document.documentElement.dataset.lite = 'true';
    return () => { delete document.documentElement.dataset.lite; };
  }, [lite]);

  const value = useMemo(() => ({ lite, setting, setSetting, reason }), [lite, setting, setSetting, reason]);
  return <LiteModeContext.Provider value={value}>{children}</LiteModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook lives beside its provider by design
export function useLiteMode() {
  return useContext(LiteModeContext);
}
