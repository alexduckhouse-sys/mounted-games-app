import { Gauge } from 'lucide-react';
import { useLiteMode } from './LiteModeContext';
import { useT } from '../i18n/LanguageContext';

/** A small header icon button shown while lite mode is on. Tapping it opens the setting. */
export function LiteChip({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const { lite } = useLiteMode();
  if (!lite) return null;
  return (
    <button
      type="button"
      className="mg-lite-chip"
      onClick={onOpen}
      aria-label={t('shell.lite.on')}
      title={t('shell.lite.title')}
    >
      <Gauge aria-hidden="true" className="h-[18px] w-[18px]" />
    </button>
  );
}
