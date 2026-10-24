import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { CompetitionDetail } from '../../types';

interface EntrySettings { competitionId: number; entriesCloseAt: string | null; entriesClosed: boolean }
type CompetitionWithCloseAt = CompetitionDetail & { entriesCloseAt?: string | null };
export function useEntrySettings(competition: CompetitionWithCloseAt) {
  const [now] = useState(() => Date.now());
  const [saved, setSaved] = useState<EntrySettings | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      void Promise.resolve(api.get<EntrySettings>(`/competitions/${competition.id}/entry-settings`)).then(({ data }) => {
        if (active && data?.competitionId === competition.id && typeof data.entriesClosed === 'boolean') setSaved(data);
      }).catch(() => { /* The API checks the closing date again when an entry is submitted. */ });
    };
    load();
    window.addEventListener('mg:entry-settings', load);
    return () => { active = false; window.removeEventListener('mg:entry-settings', load); };
  }, [competition.id]);
  const current = saved?.competitionId === competition.id ? saved : null;
  const entriesCloseAt = current ? current.entriesCloseAt : competition.entriesCloseAt ?? null;
  const closed = !!competition.signupsLocked || !!current?.entriesClosed || (!!entriesCloseAt && new Date(entriesCloseAt).getTime() <= now);
  return { entriesCloseAt, closed };
}
