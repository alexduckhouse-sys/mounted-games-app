import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** The one weather line the shell shows under the ticker, set by `WeatherAlert` on the event page. */
export interface WeatherLineModel {
  tone: 'warn' | 'paused' | 'clear';
  icon: 'thunder' | 'rain' | 'sun' | 'wind';
  text: string;
  /** The underlined words at the end. Only a tappable line has them. */
  actionLabel?: string;
  /** Present when the line can be tapped. */
  onOpen?: () => void;
}

interface WeatherLineState { line: WeatherLineModel | null; setLine: (line: WeatherLineModel | null) => void }
const Ctx = createContext<WeatherLineState | null>(null);

export function WeatherLineProvider({ children }: { children: ReactNode }) {
  const [line, setLine] = useState<WeatherLineModel | null>(null);
  const value = useMemo(() => ({ line, setLine }), [line]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The provider and its hooks deliberately share this context module.
// Without a provider (tests, the embed widget) there is simply never a line.
// eslint-disable-next-line react-refresh/only-export-components
export function useWeatherLine(): WeatherLineModel | null {
  return useContext(Ctx)?.line ?? null;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSetWeatherLine(): (line: WeatherLineModel | null) => void {
  return useContext(Ctx)?.setLine ?? NOOP;
}

const NOOP = () => {};
