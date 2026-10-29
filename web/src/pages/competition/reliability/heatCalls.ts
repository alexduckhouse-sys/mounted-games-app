import { useT } from '../../../i18n/LanguageContext';
import { useLiveHub } from '../../../live/useLiveHub';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import type { Heat, Session } from '../../../types';
export interface HeatCall { heatId: number; calledAt: string }
export function useHeatCalls(competitionId: number) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<{ competitionId: number; calls: HeatCall[] }>({ competitionId, calls: [] });
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await api.get<HeatCall[]>(`/competitions/${competitionId}/heat-calls`);
      if (sequence !== generation.current) return;
      if (!Array.isArray(response.data)) throw new Error('Invalid call-up data');
      setSnapshot({ competitionId, calls: response.data.filter(x => Number.isInteger(x.heatId) && typeof x.calledAt === 'string') });
      setError('');
    } catch { if (sequence !== generation.current) return; setSnapshot({ competitionId, calls: [] }); setError(t('reliability.callError')); }
  }, [competitionId, t]);
  useLiveHub(competitionId, { onReady: () => { void reload(); }, onSessionUpdated: () => { void reload(); }, onResultsUpdated: () => { void reload(); } });
  useEffect(() => {
    const first = window.setTimeout(() => { void reload(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 15000);
    const refresh = () => { void reload(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => { invalidate(); clearTimeout(first); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [reload, invalidate]);
  return { calls: snapshot.competitionId === competitionId ? snapshot.calls : [], error, reload };
}
export function callUpHeats(sessions: Session[], arenaName?: string): Array<{ arena: string; heats: Array<{ session: Session; heat: Heat }> }> {
  const arenas = new Map<string, Array<{ session: Session; heat: Heat }>>();
  for (const session of [...sessions].sort((a, b) => (a.scheduledStart && b.scheduledStart ? Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) : 0) || a.orderIndex - b.orderIndex)) {
    if ((session.kind ?? (session.isBreak ? 1 : 0)) !== 0) continue;
    const arena = session.arenaName?.trim() || 'Main Arena';
    if (arenaName !== undefined && arena !== (arenaName.trim() || 'Main Arena')) continue;
    const rows = arenas.get(arena) ?? [];
    for (const heat of [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (!heat.finishedAt && !(heat.races.length && heat.races.every(r => r.isComplete))) rows.push({ session, heat });
    }
    arenas.set(arena, rows);
  }
  return [...arenas].map(([arena, heats]) => ({ arena, heats: heats.slice(0, 3) })).filter(x => x.heats.length);
}
