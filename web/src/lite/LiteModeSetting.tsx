import { CardDropdownRow } from '../components/CardDropdownRow';
import { liteStatusText, type LiteSetting } from './liteMode';
import { useLiteMode } from './LiteModeContext';

const OPTIONS: { value: LiteSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/**
 * Auto / On / Off for lite mode, as a settings row for a `.sp-card`. Under the label it says why lite mode is on
 * when Auto has turned it on, and otherwise what it is for.
 */
export function LiteModeSetting() {
  const { lite, reason, setting, setSetting } = useLiteMode();
  const hint = setting === 'auto' && lite ? liteStatusText(lite, reason) : 'Saves battery and data on busy showgrounds';
  return <CardDropdownRow label="Lite mode" hint={hint} value={setting} options={OPTIONS} onChange={(value) => setSetting(value as LiteSetting)} />;
}
