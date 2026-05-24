import { createContext, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

export interface NavExtra {
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  end?: boolean;
}

interface NavExtrasState {
  extras: NavExtra[];
  setExtras: (xs: NavExtra[]) => void;
  clear: () => void;
}

const Ctx = createContext<NavExtrasState | null>(null);

export function NavExtrasProvider({ children }: { children: ReactNode }) {
  const [extras, setExtrasState] = useState<NavExtra[]>([]);

  const setExtras = useCallback((xs: NavExtra[]) => setExtrasState(xs), []);
  const clear = useCallback(() => setExtrasState([]), []);

  const value = useMemo<NavExtrasState>(() => ({ extras, setExtras, clear }), [extras, setExtras, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavExtras() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNavExtras must be used inside NavExtrasProvider');
  return ctx;
}
