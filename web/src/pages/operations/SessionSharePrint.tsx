import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import type { MessageKey } from '../../i18n/en/index';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import type { CompetitionDetail, Session } from '../../types';
import { PickRow } from '../clubShop/ui';
import { ShareTextButtons } from './ShareTextButtons';
import { sessionPrintPath, type SessionPrintView } from './sessionPrint';
import { drawShareText } from './shareText';

const PRINTS: { value: SessionPrintView; label: MessageKey }[] = [
  { value: 'draw', label: 'ops2.sp.draw' },
  { value: 'score-sheets', label: 'ops2.sp.scoreSheets' },
  { value: 'results', label: 'ops2.sp.results' },
];

/**
 * Organiser tools for one session, as two settings rows: print just this session (pick which sheet), or send its
 * lanes to a group chat (see the message, then share, copy or WhatsApp it).
 */
export function SessionSharePrint({ competition, session }: { competition: Pick<CompetitionDetail, 'id' | 'name'>; session: Session }) {
  const navigate = useNavigate();
  const t = useT();
  const [sending, setSending] = useState(false);
  const hasDraw = session.heats.length > 0;
  const text = hasDraw ? drawShareText(competition, session, `${window.location.origin}/competitions/${competition.id}`) : '';
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[rgb(var(--mg-rule))] divide-y divide-[rgb(var(--mg-rule-soft))]" role="group" aria-label={t('ops2.sp.group')}>
      <PickRow label={t('ops2.sp.print')} value={null} options={PRINTS.map((p) => ({ value: p.value, label: t(p.label) }))}
        onPick={(view) => navigate(sessionPrintPath(competition.id, view as SessionPrintView, session.id))} />
      {hasDraw && (
        <button type="button" className="flex min-h-14 w-full items-center gap-3 bg-[rgb(var(--mg-surface))] px-4 text-left" aria-haspopup="dialog" onClick={() => setSending(true)}>
          <span className="flex-1 text-base font-semibold text-[rgb(var(--mg-ink))]">{t('ops2.sp.send')}</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" strokeWidth={2.5} />
        </button>
      )}
      {sending && (
        <Sheet title={t('ops2.sp.send')} onClose={() => setSending(false)}>
          {() => (
            <div className="kit-sheet-inner">
              <pre className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-xl bg-[rgb(var(--mg-tint))] p-3 font-[inherit] text-sm text-[rgb(var(--mg-ink))]">{text}</pre>
              <ShareTextButtons title={t('ops2.sp.shareDraw')} name={t('ops2.sp.draw')} text={text} />
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
