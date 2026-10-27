import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { detectTimetableClashes, type TimetableClash, type TimetableDeclarationInput } from '../../lib/timetableClashes';
import { clashReason, clashesForSession } from './clashText';
import type { CompetitionDetail, DeclarationForm } from '../../types';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';

function timing(clash: TimetableClash): string {
  const gap = clash.gapMinutes === 0 ? 'at the same time' : `${clash.gapMinutes} min apart`;
  return `${clash.first.arenaName} ${clash.first.timeText} and ${clash.second.arenaName} ${clash.second.timeText}, ${gap}`;
}

/**
 * Organisers only. Teams that share a trainer or a pony and are due in two arenas close together get a quiet
 * warning under the session they affect. The riders' declarations are read only to spot shared ponies.
 */
export function TimetableClashes({ competition }: { competition: CompetitionDetail }) {
  const [declarations, setDeclarations] = useState<TimetableDeclarationInput[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then(({ data }) => { if (!cancelled && Array.isArray(data)) setDeclarations(data.map((form) => ({ teamId: form.teamId, riders: form.riders ?? [] }))); })
      .catch(() => { /* Without declarations only shared trainers are checked. */ });
    return () => { cancelled = true; };
  }, [competition.id]);

  const clashes = useMemo(() => detectTimetableClashes(competition, { declarations }), [competition, declarations]);
  const sessions = useMemo(
    () => competition.sessions
      .map((session) => ({ session, found: clashesForSession(clashes, session.id) }))
      .filter((item) => item.found.length > 0),
    [competition.sessions, clashes],
  );
  if (sessions.length === 0) return null;

  return (
    <section aria-label="Clashes between sessions">
      <RefineSection title="Clashes to look at" meta={clashes.length} />
      <RefineNote>These teams share a trainer or a pony and are due in different arenas within 15 minutes. Only organisers see this.</RefineNote>
      {sessions.map(({ session, found }) => (
        <RefineList as="div" key={session.id} label={session.name}>
          <div className="rf-row"><span className="rf-grow rf-t1">{session.name}</span><span className="rf-t2">{found.length === 1 ? '1 clash' : `${found.length} clashes`}</span></div>
          {found.map((clash) => (
            <div key={clash.key} className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{clash.first.team.displayName} and {clash.second.team.displayName}</span>
                <span className="rf-t2">{clashReason(clash)}</span>
                <span className="rf-t2">{timing(clash)}</span>
              </span>
            </div>
          ))}
        </RefineList>
      ))}
    </section>
  );
}
