export type ThemeName = 'eguk' | 'light' | 'dark' | 'ocean' | 'sunset';

export const THEMES: { id: ThemeName; label: string; swatch: string }[] = [
  { id: 'eguk', label: 'EGUK Navy', swatch: 'linear-gradient(135deg, #1e3466, #5577bb)' },
  { id: 'light', label: 'Meadow', swatch: 'linear-gradient(135deg, #f1f7f4, #c4e3d4)' },
  { id: 'dark', label: 'Stable Night', swatch: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg, #bae6fd, #38bdf8)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #fed7aa, #fb923c)' },
];
