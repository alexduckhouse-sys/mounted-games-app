import { Gauge } from 'lucide-react';
import { useLiteMode } from './LiteModeContext';

/** A small header chip shown while lite mode is on. Tapping it opens the setting. */
export function LiteChip({ onOpen, short = false }: { onOpen: () => void; short?: boolean }) {
  const { lite } = useLiteMode();
  if (!lite) return null;
  return (
    <button type="button" className="mg-lite-chip" onClick={onOpen} aria-label="Lite mode is on. Open the setting">
      <span><Gauge aria-hidden="true" />{short ? 'Lite' : 'Lite mode'}</span>
    </button>
  );
}
