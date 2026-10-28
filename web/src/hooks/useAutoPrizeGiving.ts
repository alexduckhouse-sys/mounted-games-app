import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { AUTO_CHAMPION_SECONDS, AUTO_PLACES, AUTO_PLACE_SECONDS, autoPrizeGivingFrames, newlyFinished, revealOrder, type PrizeGiving } from '../lib/prizeGiving';
import { displaySectionName } from '../lib/section';
import { buildToplist, sectionFinalsState } from '../lib/toplist';
import type { CompetitionDetail, StandingRow } from '../types';

type Comp = Pick<CompetitionDetail, 'id' | 'sessions' | 'sections' | 'teams'>;

const isStandings = (data: unknown): data is StandingRow[] =>
  Array.isArray(data) && data.every((row) => row && Number.isFinite(row.teamId) && typeof row.teamName === 'string' && Number.isFinite(row.totalPoints));

/**
 * The prize-giving that plays itself on the stream when an age group's last final is scored. It runs in each viewer's
 * browser, so it needs no organiser page open and nothing on the server: every viewer watching sees the places go up
 * from last to first, then the winners, then it clears. Age groups already finished when the page opened don't replay,
 * and a prize-giving the organiser is stepping through by hand (`manual`) always wins. Returns the one to show.
 */
export function useAutoPrizeGiving({ competition, enabled, manual }: { competition: Comp | null; enabled: boolean; manual: boolean }): PrizeGiving | null {
  const [current, setCurrent] = useState<PrizeGiving | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const queue = useRef<number[]>([]);
  const running = useRef(false);
  const latest = useRef({ competition, enabled, manual });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const [tick, setTick] = useState(0);
  useEffect(() => { latest.current = { competition, enabled, manual }; });

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  // Notice an age group's finals being scored.
  useEffect(() => {
    if (!competition) return;
    const done = new Set(competition.sections.filter((section) => sectionFinalsState(competition.sessions, section.id).finalsDone).map((section) => section.id));
    const fresh = newlyFinished(seen.current, done);
    seen.current = done;
    if (fresh.length === 0 || !enabled) return;
    queue.current.push(...fresh.filter((id) => !queue.current.includes(id)));
    setTick((n) => n + 1);
  }, [competition, enabled]);

  // Play the queue one age group at a time.
  useEffect(() => {
    if (manual) { if (timer.current) clearTimeout(timer.current); timer.current = null; running.current = false; void Promise.resolve().then(() => { if (alive.current) setCurrent(null); }); return; }
    if (running.current || queue.current.length === 0) return;
    const comp = latest.current.competition;
    const sectionId = queue.current.shift()!;
    const section = comp?.sections.find((item) => item.id === sectionId);
    if (!comp || !section) return;
    running.current = true;
    const finish = () => { running.current = false; if (alive.current) setTick((n) => n + 1); };
    api.get<unknown>(`/competitions/${comp.id}/standings`, { params: { sectionId } })
      .then(({ data }) => {
        if (!alive.current || latest.current.manual) return finish();
        if (!isStandings(data)) return finish();
        const fresh = latest.current.competition ?? comp;
        const toplist = buildToplist(data, fresh.sessions, fresh.teams, sectionId, undefined);
        const order = revealOrder(toplist, AUTO_PLACES);
        const frames = autoPrizeGivingFrames(order, sectionId, displaySectionName(section.displayName || section.ageGroup), (teamId) => data.find((row) => row.teamId === teamId)?.clubName || null);
        if (frames.length === 0) return finish();
        const play = (index: number) => {
          if (!alive.current || latest.current.manual) return;
          if (index >= frames.length) { setCurrent(null); timer.current = null; return finish(); }
          setCurrent(frames[index]);
          const last = index === frames.length - 1;
          timer.current = setTimeout(() => play(index + 1), (last && frames[index].champions ? AUTO_CHAMPION_SECONDS : AUTO_PLACE_SECONDS) * 1000);
        };
        play(0);
      })
      .catch(finish);
  }, [tick, manual]);

  return manual ? null : current;
}
