type EmojiIcon = { id: string; label: string; symbol: string; src?: undefined };
type FlagIcon = { id: string; label: string; src: string; symbol?: undefined };
export type CompetitionIconOption = EmojiIcon | FlagIcon;

const flag = (id: string, label: string): FlagIcon => ({ id, label, src: `/flags/${id}.png` });

const EMOJI_ICONS: EmojiIcon[] = [
  { id: 'flag', symbol: '🏁', label: 'Chequered flag' },
  { id: 'world', symbol: '🌍', label: 'World' },
  { id: 'trophy', symbol: '🏆', label: 'Trophy' },
];

export const UK_FLAG_ICONS: FlagIcon[] = [
  flag('gb', 'United Kingdom'),
  flag('gb-eng', 'England'),
  flag('gb-sct', 'Scotland'),
  flag('gb-wls', 'Wales'),
  flag('gb-nir', 'Northern Ireland'),
];

// Bundled in public/flags (never hot-linked), so they work offline and under the img-src 'self' CSP.
export const OTHER_FLAG_ICONS: FlagIcon[] = [
  flag('ie', 'Ireland'),
  flag('fr', 'France'),
  flag('de', 'Germany'),
  flag('nl', 'Netherlands'),
  flag('be', 'Belgium'),
  flag('es', 'Spain'),
  flag('pt', 'Portugal'),
  flag('it', 'Italy'),
  flag('ch', 'Switzerland'),
  flag('at', 'Austria'),
  flag('se', 'Sweden'),
  flag('no', 'Norway'),
  flag('dk', 'Denmark'),
  flag('fi', 'Finland'),
  flag('pl', 'Poland'),
  flag('cz', 'Czechia'),
  flag('us', 'United States'),
  flag('ca', 'Canada'),
  flag('au', 'Australia'),
  flag('nz', 'New Zealand'),
  flag('za', 'South Africa'),
].sort((a, b) => a.label.localeCompare(b.label, 'en-GB'));

export const EMOJI_COMPETITION_ICONS: readonly EmojiIcon[] = EMOJI_ICONS;
export const FLAG_COMPETITION_ICONS: readonly FlagIcon[] = [...UK_FLAG_ICONS, ...OTHER_FLAG_ICONS];

/** Emoji icons first, then the UK flags, then the other flags alphabetically by label. */
export const COMPETITION_ICONS: readonly CompetitionIconOption[] = [...EMOJI_COMPETITION_ICONS, ...FLAG_COMPETITION_ICONS];

export function competitionIcon(id?: string | null): CompetitionIconOption {
  return COMPETITION_ICONS.find((icon) => icon.id === id) ?? COMPETITION_ICONS[0];
}
