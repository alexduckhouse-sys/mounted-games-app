import { CardDropdownRow } from '../components/CardDropdownRow';
import { liteStatusText, type LiteSetting } from './liteMode';
import { useLiteMode } from './LiteModeContext';
import { useT } from '../i18n/LanguageContext';

/**
 * Auto / On / Off for lite mode, as a settings row for a `.sp-card`. Under the label it says why lite mode is on
 * when Auto has turned it on, and otherwise what it is for.
 */
export function LiteModeSetting() {
  const t = useT();
  const { lite, reason, setting, setSetting } = useLiteMode();
  const hint = setting === 'auto' && lite ? liteStatusText(lite, reason) : t('shell.liteMode.hint');
  const options: { value: LiteSetting; label: string }[] = [
    { value: 'auto', label: t('shell.liteMode.auto') },
    { value: 'on', label: t('shell.liteMode.on') },
    { value: 'off', label: t('shell.liteMode.off') },
  ];
  return <CardDropdownRow label={t('shell.liteMode.label')} hint={hint} value={setting} options={options} onChange={(value) => setSetting(value as LiteSetting)} />;
}
