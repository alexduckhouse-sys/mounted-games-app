import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeName = 'light' | 'dark' | 'ocean' | 'sunset';

export const THEMES: { id: ThemeName; label: string; swatch: string }[] = [
  { id: 'light', label: 'Meadow', swatch: 'linear-gradient(135deg, #f1f7f4, #c4e3d4)' },
  { id: 'dark', label: 'Stable Night', swatch: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg, #bae6fd, #38bdf8)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #fed7aa, #fb923c)' },
];

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const KEY = 'mg.theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(KEY) as ThemeName | null;
    return stored ?? 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
