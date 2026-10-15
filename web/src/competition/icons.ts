export const COMPETITION_ICONS = [
  { id: 'flag', symbol: '🏁', label: 'Chequered flag' },
  { id: 'gb', symbol: '🇬🇧', label: 'United Kingdom' },
  { id: 'ie', symbol: '🇮🇪', label: 'Ireland' },
  { id: 'fr', symbol: '🇫🇷', label: 'France' },
  { id: 'de', symbol: '🇩🇪', label: 'Germany' },
  { id: 'nl', symbol: '🇳🇱', label: 'Netherlands' },
  { id: 'world', symbol: '🌍', label: 'World' },
  { id: 'trophy', symbol: '🏆', label: 'Trophy' },
] as const;

export function competitionIcon(id?: string | null) {
  return COMPETITION_ICONS.find((icon) => icon.id === id) ?? COMPETITION_ICONS[0];
}
