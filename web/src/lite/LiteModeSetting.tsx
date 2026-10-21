import { liteStatusText, type LiteSetting } from './liteMode';
import { useLiteMode } from './LiteModeContext';

const OPTIONS: { id: LiteSetting; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

/** Auto / On / Off for lite mode, with one line saying where it stands. */
export function LiteModeSetting() {
  const { lite, reason, setting, setSetting } = useLiteMode();
  return (
    <div role="group" aria-label="Lite mode" className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">Lite mode</h3>
      <div className="mg-seg">
        {OPTIONS.map((option) => (
          <button key={option.id} type="button" aria-pressed={setting === option.id} onClick={() => setSetting(option.id)}>{option.label}</button>
        ))}
      </div>
      <p role="status" className="px-1 text-[13px] leading-snug text-[rgb(var(--mg-muted))]">{liteStatusText(lite, reason)}</p>
    </div>
  );
}
