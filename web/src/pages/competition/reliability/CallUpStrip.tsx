import { Sheet } from '../../../components/Sheet';
import { useT } from '../../../i18n/LanguageContext';
import { useHeatCalls, callUpHeats, type HeatCall } from './heatCalls';
import { useState } from 'react';
import { api } from '../../../api';
import type { Session } from '../../../types';
import { Notice } from '../../../components/Notice';

export function HeatCalledBadge({ heatId, calls }: { heatId: number; calls: HeatCall[] }) {
  const t = useT();
  return calls.some(x => x.heatId === heatId) ? <span className="sp-note" role="status">{t('reliability.called')}</span> : null;
}
export function CallUpStrip({ competitionId, sessions, arenaName, compact = false }: { competitionId: number; sessions: Session[]; arenaName?: string; compact?: boolean }) {
  const t = useT();
  const { calls, error: readError, reload } = useHeatCalls(competitionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [missingCalled, setMissingCalled] = useState<string[]>([]);
  async function call(heatId: number, teamId?: number) {
    setBusy(`${heatId}:${teamId ?? ''}`); setError('');
    try {
      if (teamId !== undefined) { await api.post(`/heats/${heatId}/call-missing-team`, { teamId }); setMissingCalled(ids => [...ids, `${heatId}:${teamId}`]); }
      else await api.post(`/competitions/${competitionId}/heat-calls/${heatId}`);
      await reload();
    } catch { setError(t('reliability.callFailed')); await reload(); }
    finally { setBusy(null); }
  }
  const groups = callUpHeats(sessions, arenaName);
  if (!groups.length) return null;
  const board = <section aria-label={t('reliability.calls')} className="space-y-3">
    {(error || readError) && <Notice>{error || readError}</Notice>}
    {groups.map(group => <div className="sp-card" key={group.arena}>
      <h2 className="sp-t1 px-4 pt-3">{group.arena} · {t('reliability.board')}</h2>
      {group.heats.map(({ session, heat }, i) => {
        const started = !!heat.startedAt || heat.races.some(r => !!r.startedAt || r.isComplete);
        const called = calls.some(c => c.heatId === heat.id);
        return <div key={heat.id} className="border-t border-[rgb(var(--mg-rule-soft))] p-4 space-y-2">
          <p className="m-0"><span className="sp-note">{i === 0 ? t('reliability.current') : t('reliability.next', { n: i })}</span> · {session.name} · {heat.label || t('reliability.heat', { n: heat.orderIndex })}</p>
          {started ? <p className="sp-note">{t('reliability.inArena')}</p> : <>
            <button type="button" className="kit-pill" disabled={!!busy || called || !!readError} onClick={() => void call(heat.id)}>{called ? t('reliability.called') : t('reliability.callHeat', { heat: heat.label || t('reliability.heat', { n: heat.orderIndex }) })}</button>
            <details><summary className="sc-link cursor-pointer">{t('reliability.missing')}</summary><div className="flex flex-wrap gap-2 py-2">{heat.entries.map(entry => <button key={entry.id} type="button" className="kit-pill" disabled={!!busy || missingCalled.includes(`${heat.id}:${entry.teamId}`)} onClick={() => void call(heat.id, entry.teamId)}>{t(missingCalled.includes(`${heat.id}:${entry.teamId}`) ? 'reliability.calledTeam' : 'reliability.callTeam', { team: entry.teamName })}</button>)}</div></details>
          </>}
        </div>;
      })}
    </div>)}
  </section>;
  return compact ? <><button type="button" className="kit-pill" onClick={() => setOpen(true)}>{t('reliability.calls')}</button>{open && <Sheet title={t('reliability.calls')} onClose={() => setOpen(false)}>{board}</Sheet>}</> : board;
}
