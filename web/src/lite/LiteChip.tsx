import { Gauge } from 'lucide-react';
import { useLiteMode } from './LiteModeContext';

/** A small header icon button shown while lite mode is on. Tapping it opens the setting. */
export function LiteChip({ onOpen }: { onOpen: () => void }) {
  const { lite } = useLiteMode();
  if (!lite) return null;
  return (
    <button
      type="button"
      className="mg-lite-chip"
      onClick={onOpen}
      aria-label="Lite mode is on. Open the setting"
      title="Lite mode is on"
    >
      <Gauge aria-hidden="true" className="h-[18px] w-[18px]" />
    </button>
  );
}
