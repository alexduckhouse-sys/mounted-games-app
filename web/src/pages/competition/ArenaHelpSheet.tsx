import { useState } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useArenaAssistance } from '../../hooks/useArenaAssistance';
import { ARENA_ASSISTANCE_SERVICES } from '../../lib/arenaAssistance';
import type { ArenaAssistanceService } from '../../types';
import '../refine/refine.css';

/** Farrier, vet and first aid calls for one arena. Each one is confirmed first because it posts a notice for the whole event. */
export function ArenaHelpSheet({ competitionId, sessionId, arenaName, onClose }: {
  competitionId: number;
  sessionId: number;
  arenaName: string;
  onClose: () => void;
}) {
  const t = useT();
  const { callAssistance, sendingService, error } = useArenaAssistance({ competitionId, sessionId, defaultArenaName: arenaName });
  const [holdArena, setHoldArena] = useState(true);
  const [sent, setSent] = useState<ArenaAssistanceService[]>([]);

  async function call(service: ArenaAssistanceService, name: string) {
    const ok = await confirmDialog({
      title: t('desk.commentary.callTitle', { name }),
      message: t(holdArena ? 'desk.commentary.callMsgHold' : 'desk.commentary.callMsg', { name, arena: arenaName }),
      confirmLabel: t('desk.commentary.callConfirm', { name }),
    });
    if (!ok) return;
    const msg = await callAssistance(service, { holdArena });
    if (msg) setSent((current) => (current.includes(service) ? current : [...current, service]));
  }

  return (
    <Sheet title={t('desk.commentary.callForHelp')} description={t('desk.commentary.forArena', { arena: arenaName })} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {ARENA_ASSISTANCE_SERVICES.map((option) => {
          const name = t(`desk.commentary.svc.${option.id}`);
          const done = sent.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className="kit-pill min-h-[44px]"
              disabled={sendingService !== null}
              onClick={() => void call(option.id, name)}
            >
              {sendingService === option.id
                ? t('desk.commentary.calling', { name })
                : done ? t('desk.commentary.sentAgain', { name }) : t('desk.commentary.callBtn', { name })}
            </button>
          );
        })}
      </div>
      <div className="rt-link">
        <span className="rt-link-text"><span className="rt-link-name">{t('desk.commentary.pauseArena')}</span><span className="rt-link-sub">{t('desk.commentary.pauseHint')}</span></span>
        <button type="button" role="switch" aria-checked={holdArena} aria-label={t('desk.commentary.pauseArena')} className="rf-sw" onClick={() => setHoldArena((on) => !on)}><span aria-hidden="true" /></button>
      </div>
      {sent.length > 0 && <Notice tone="info" role="status">{t('desk.commentary.noticeSent')}</Notice>}
      {error && <Notice>{error}</Notice>}
    </Sheet>
  );
}
