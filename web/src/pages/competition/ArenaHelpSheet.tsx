import { useState } from 'react';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useArenaAssistance } from '../../hooks/useArenaAssistance';
import { ARENA_ASSISTANCE_SERVICES } from '../../lib/arenaAssistance';
import type { ArenaAssistanceService } from '../../types';

/** Farrier, vet and first aid calls for one arena. Each one is confirmed first because it posts a notice for the whole event. */
export function ArenaHelpSheet({ competitionId, sessionId, arenaName, onClose }: {
  competitionId: number;
  sessionId: number;
  arenaName: string;
  onClose: () => void;
}) {
  const { callAssistance, sendingService, error } = useArenaAssistance({ competitionId, sessionId, defaultArenaName: arenaName });
  const [holdArena, setHoldArena] = useState(true);
  const [sent, setSent] = useState<ArenaAssistanceService[]>([]);

  async function call(service: ArenaAssistanceService, name: string) {
    const ok = await confirmDialog({
      title: `Call the ${name}?`,
      message: `This posts a notice that the ${name} is needed at ${arenaName}${holdArena ? ' and pauses the arena' : ''}.`,
      confirmLabel: `Call ${name}`,
    });
    if (!ok) return;
    const msg = await callAssistance(service, { holdArena });
    if (msg) setSent((current) => (current.includes(service) ? current : [...current, service]));
  }

  return (
    <Sheet title="Call for help" description={`For ${arenaName}. Everyone at the event sees the notice.`} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {ARENA_ASSISTANCE_SERVICES.map((option) => {
          const name = option.shortLabel.toLowerCase();
          const done = sent.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className="kit-pill min-h-[44px]"
              disabled={sendingService !== null}
              onClick={() => void call(option.id, name)}
            >
              {sendingService === option.id ? `Calling ${name}…` : done ? `Sent. Call ${name} again` : `Call ${name}`}
            </button>
          );
        })}
      </div>
      <label className="rt-link">
        <span className="rt-link-text"><span className="rt-link-name">Pause the arena</span><span className="rt-link-sub">Holds this arena’s timetable while help arrives</span></span>
        <input type="checkbox" role="switch" checked={holdArena} onChange={() => setHoldArena((on) => !on)} />
      </label>
      {sent.length > 0 && <Notice tone="info" role="status">Notice sent to the event.</Notice>}
      {error && <Notice>{error}</Notice>}
    </Sheet>
  );
}
