import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Info, Lock, MapPin, Ticket } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { competitionDateText } from '../../lib/competitionDates';
import { entryFeeText } from '../../lib/competitionPhase';
import type { SectionSignup } from '../../types';
import { Chevron, RefineList } from '../refine/Refine';
import { useCompetition } from './context';
import { EnterCompetition } from './DetailsTab';
import type { ReactNode } from 'react';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';

/**
 * The whole of a new competition's public face while entries are open: what and when, then one card per age group
 * to enter. The timetable, toplists and live feed have nothing to show yet, so the tab bar leaves them out
 * (see `competitionPhase`). Also reachable at `/competitions/:id/enter` once the event has started.
 */
export function EntryPage() {
  usePageWidth('wide');
  const { competition, reload } = useCompetition();
  const { canOrganise, user } = useAuth();
  const mayOrganise = canOrganise(competition);
  const [loaded, setLoaded] = useState<{ id: number; items: SectionSignup[] } | null>(null);
  const allSignups = mayOrganise && loaded?.id === competition.id ? loaded.items : [];

  async function refreshSignups() {
    if (!mayOrganise) return;
    try {
      const r = await api.get<SectionSignup[]>(`/competitions/${competition.id}/signups`);
      setLoaded({ id: competition.id, items: r.data });
    } catch { setLoaded({ id: competition.id, items: [] }); }
  }

  useEffect(() => {
    let cancelled = false;
    if (mayOrganise) {
      api.get<SectionSignup[]>(`/competitions/${competition.id}/signups`)
        .then(({ data }) => { if (!cancelled) setLoaded({ id: competition.id, items: data }); })
        .catch(() => { if (!cancelled) setLoaded({ id: competition.id, items: [] }); });
    }
    return () => { cancelled = true; };
  }, [competition.id, mayOrganise]);

  const fee = entryFeeText(competition.sections);
  const dates = competitionDateText(competition.startDate, competition.endDate, true);
  const row = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true">{icon}</span>
      <div className="flex flex-col gap-0.5"><dt className="rf-t2 !font-bold uppercase tracking-[0.08em]">{label}</dt><dd className="m-0 break-words text-[15px]">{value}</dd></div>
    </div>
  );

  return (
    <div className="rf-page mx-auto w-full max-w-3xl pb-4 pt-3 lg:max-w-none">
      <PageGrid railFirst className="!gap-2.5 lg:!gap-6" aside={(
      <div className="mg-card flex flex-col gap-4 p-4">
        <div>
          <span className="mg-badge bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]">{competition.signupsLocked ? 'Entries closed' : 'Entries open'}</span>
          <h1 className="mg-display mt-2 text-2xl font-bold leading-[1.1] text-[rgb(var(--mg-heading))]">{competition.name}</h1>
          {competition.organiserName && <p className="mg-meta mt-1">Organised by <span className="font-semibold">{competition.organiserName}</span></p>}
          {competition.description && <p className="mg-lede mt-2 whitespace-pre-wrap">{competition.description}</p>}
        </div>
        <dl className="m-0 grid grid-cols-1 gap-3">
          {dates && row(<CalendarDays className="h-4 w-4" />, 'Date', dates)}
          {competition.location && row(<MapPin className="h-4 w-4" />, 'Venue', competition.location)}
          {fee && row(<Ticket className="h-4 w-4" />, 'Entry fee', fee)}
        </dl>
      </div>
      )} asideLabel="About this event">
      <div className="flex flex-col gap-2.5">

      {competition.signupsLocked && (
        <p role="status" className="mg-notice flex items-center gap-2"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" /> Entries for this event are closed.</p>
      )}

      <EnterCompetition competition={competition} allSignups={allSignups} mayOrganise={mayOrganise} onChanged={() => { void refreshSignups(); reload(); }} />

      {!user && !competition.signupsLocked && (
        <p className="rf-note !px-1">You need an account to enter. It takes a minute, and you will come straight back here.</p>
      )}

      <p className="rf-note !px-1">The timetable, toplists and live scores open once the teams are drawn.</p>

      <RefineList label="More about this event">
        <li>
          <Link className="rf-row" to="details">
            <Info className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <span className="rf-grow rf-t1">Venue, rules and shop</span>
            <Chevron />
          </Link>
        </li>
      </RefineList>
      </div>
      </PageGrid>
    </div>
  );
}
