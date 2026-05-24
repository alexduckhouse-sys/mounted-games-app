import { useCallback, useEffect, useState } from 'react';
import { useParams, Outlet } from 'react-router-dom';
import { api } from '../api';
import type { CompetitionDetail, Session, Heat } from '../types';
import { useLiveHub } from '../live/useLiveHub';
import { CompetitionContext } from './competition/context';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from '../components/NavExtrasContext';

export function CompetitionPage() {
  const { id } = useParams<{ id: string }>();
  const competitionId = id ? parseInt(id, 10) : null;
  const [data, setData] = useState<CompetitionDetail | null>(null);
  const { setCurrent } = useCurrentCompetition();

  const load = useCallback(() => {
    if (competitionId == null) return;
    api.get<CompetitionDetail>(`/competitions/${competitionId}`).then((r) => setData(r.data));
  }, [competitionId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (data) setCurrent({ id: data.id, name: data.name });
  }, [data, setCurrent]);

  const { setExtras, clear } = useNavExtras();
  useEffect(() => {
    setExtras([]);
    return () => clear();
  }, [competitionId, setExtras, clear]);

  useLiveHub(competitionId, {
    onSessionUpdated: (s) => {
      const updated = s as Session;
      setData((cur) => {
        if (!cur) return cur;
        const sessions = cur.sessions.map((x) => (x.id === updated.id ? updated : x));
        return { ...cur, sessions };
      });
    },
    onResultsUpdated: (p) => {
      const payload = p as { sessionId: number; heat: Heat };
      setData((cur) => {
        if (!cur) return cur;
        const sessions = cur.sessions.map((s) => {
          if (s.id !== payload.sessionId) return s;
          const heats = s.heats.map((h) => (h.id === payload.heat.id ? payload.heat : h));
          return { ...s, heats };
        });
        return { ...cur, sessions };
      });
    },
  });

  if (!data || competitionId == null) return <p className="text-slate-500">Loading competition…</p>;

  return (
    <CompetitionContext.Provider value={{ competition: data, reload: load }}>
      <div className="space-y-3">
        <Outlet />
      </div>
    </CompetitionContext.Provider>
  );
}
