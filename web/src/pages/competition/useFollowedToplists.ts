import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { buildToplist, sectionScoreVersion, type Toplist } from '../../lib/toplist';
import { readSavedCopy, savedCopyKeys, writeSavedCopy } from '../../offline/savedCopies';
import type { CompetitionDetail, StandingRow } from '../../types';

/**
 * The toplist of each age group a followed team rides in, built the way the Toplists page builds it (official
 * standings from the API, kept as a saved copy, plus the sessions for what is left to ride). A group whose standings
 * haven't arrived and weren't saved before has no entry yet.
 */
export function useFollowedToplists(competition: CompetitionDetail, sectionIds: readonly number[]): Map<number, Toplist> {
  const [standings, setStandings] = useState<Record<number, StandingRow[]>>({});
  const wanted = [...new Set(sectionIds)].sort((a, b) => a - b);
  const wantedKey = wanted.join(',');
  const version = wanted.map((id) => sectionScoreVersion(competition.sessions, id)).join('|');
  const { id: competitionId, teams, sections } = competition;

  useEffect(() => {
    let cancelled = false;
    for (const sectionId of wantedKey ? wantedKey.split(',').map(Number) : []) {
      const key = savedCopyKeys.standings(competitionId, sectionId);
      api.get<StandingRow[]>(`/competitions/${competitionId}/standings`, { params: { sectionId } })
        .then((response) => {
          if (cancelled || !Array.isArray(response.data)) return;
          writeSavedCopy(key, response.data);
          setStandings((previous) => ({ ...previous, [sectionId]: response.data }));
        })
        .catch(() => {
          // A failed refresh falls back to the copy this phone saved last time, if there is one.
          const saved = readSavedCopy<StandingRow[]>(key);
          if (!cancelled && saved) setStandings((previous) => previous[sectionId] ? previous : { ...previous, [sectionId]: saved.data });
        });
    }
    return () => { cancelled = true; };
  }, [competitionId, wantedKey, version, teams, sections]);

  return useMemo(() => {
    const lists = new Map<number, Toplist>();
    for (const sectionId of wantedKey ? wantedKey.split(',').map(Number) : []) {
      const rows = standings[sectionId] ?? readSavedCopy<StandingRow[]>(savedCopyKeys.standings(competitionId, sectionId))?.data;
      if (!rows) continue;
      const section = sections.find((item) => item.id === sectionId);
      lists.set(sectionId, buildToplist(rows, competition.sessions, teams, sectionId, section?.finalistCount));
    }
    return lists;
  }, [standings, wantedKey, competitionId, competition.sessions, teams, sections]);
}
