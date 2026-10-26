import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { EntryStepper } from '../../components/EntryStepper';
import { usePageWidth } from '../../components/pageWidthState';
import { EntryRosette } from '../../components/Rosette';
import { entryPhaseOnly } from '../../lib/competitionPhase';
import { entryOptions, feeText, parseEntryKind, sectionFull, type EntryKind } from '../../lib/entryOptions';
import { displaySectionName } from '../../lib/section';
import { useCompetition } from './context';
import { EntryForm, type EntrySent } from './EntryForm';
import { useEntrySettings } from './entrySettings';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/**
 * Entering a competition, in up to three steps that share one stepper so it can animate from step to step:
 * what you are entering (`/enter`), your details (`/enter/:sectionId`) and, when there is a fee, paying
 * (`/enter/:sectionId/pay`). Guest riders, the waiting list and free age groups have nothing to pay, so they stop
 * after the details. It is also the public home of a competition while entries are the only thing to do.
 */
export function EntryPage() {
  usePageWidth('narrow');
  const { competition } = useCompetition();
  const { user, canOrganise } = useAuth();
  const location = useLocation();
  const [search] = useSearchParams();
  const rest = (useParams()['*'] ?? '').split('/').filter(Boolean);
  const [sectionPart, stepPart] = rest;
  const section = sectionPart ? competition.sections.find((s) => s.id === Number(sectionPart)) ?? null : null;
  const kind: EntryKind = parseEntryKind(search.get('type')) ?? (search.get('waitlist') === '1' ? 'waitlist' : 'standard');
  const [sent, setSent] = useState<EntrySent | null>(null);
  const entrySettings = useEntrySettings(competition);
  const mayOrganise = canOrganise(competition);
  const closed = entrySettings.closed && !mayOrganise;
  // Where Back goes from the first step: where you came from, or the competition's front page.
  const [cameFrom] = useState(() => (location.state as { from?: string } | null)?.from);
  const home = Array.isArray(competition.sessions) && entryPhaseOnly(competition, mayOrganise)
    ? `/competitions/${competition.id}`
    : `/competitions/${competition.id}/details`;
  const firstBack = cameFrom?.startsWith('/competitions/') ? cameFrom : home;
  const atHome = !location.pathname.includes('/enter');
  const base = `/competitions/${competition.id}/enter`;
  const query = kind === 'standard' ? '' : `?type=${kind}`;

  const option = section ? entryOptions(section, sectionFull(section)).find((o) => o.kind === kind) : undefined;
  const pays = (option?.priceMinor ?? 1) > 0;
  const labels = pays ? ['Section', 'Your details', 'Pay'] : ['Section', 'Your details'];
  const current = sent ? labels.length + 1 : !section ? 1 : stepPart === 'pay' ? 3 : 2;

  const backTo = sent || !section ? (atHome && !sent ? undefined : sent ? home : firstBack)
    : stepPart === 'pay' ? `${base}/${section.id}${query}` : base;
  usePageHeader({
    title: 'Enter',
    subtitle: section && !sent ? `${competition.name} · ${displaySectionName(section.displayName)}` : competition.name,
    plain: true,
    backTo,
    backLabel: 'Back',
  });

  function chooseHref(sectionId: number, chosen: EntryKind) {
    return `${base}/${sectionId}${chosen === 'standard' ? '' : `?type=${chosen}`}`;
  }

  let body;
  if (sent && section) {
    body = (
      <div className="ev-card flex flex-col gap-2.5 p-5">
        <h2 className="ev-title">Entry submitted</h2>
        <p className="ev-body">{sent.text}</p>
        {sent.enteredAs && (
          <EntryRosette team={sent.enteredAs} section={displaySectionName(section.displayName)} year={new Date(competition.startDate).getFullYear()} />
        )}
        <div className="sp-acts mt-1.5"><Link to={home} className="sp-pill">Back to details</Link></div>
      </div>
    );
  } else if (section && !user) {
    body = (
      <div className="sp-card flex flex-col gap-3 p-4">
        <p className="ev-body">Sign in to enter this age group.</p>
        <Link to="/login" state={{ from: `${location.pathname}${location.search}` }} className="ev-bar !mt-0">Sign in to enter</Link>
      </div>
    );
  } else if (section) {
    body = <EntryForm key={`${section.id}:${kind}`} competition={competition} section={section} kind={kind} step={stepPart === 'pay' ? 'pay' : 'details'} onSent={setSent} />;
  } else if (sectionPart) {
    body = <Notice actionLabel="Choose an age group" actionTo={base}>Section not found.</Notice>;
  } else {
    body = (
      <>
        <h2 className="ev-step-title">What are you entering?</h2>
        {closed && <Notice tone="info" className="mb-3">Entries are closed for this competition.</Notice>}
        {competition.sections.length === 0 && <p className="sp-note">There are no age groups to enter yet.</p>}
        {competition.sections.map((s) => (
          <section key={s.id} aria-label={s.displayName}>
            <h3 className="sp-sec">{displaySectionName(s.displayName)}</h3>
            <div className="sp-card">
              {closed ? (
                <div className="sp-row"><span className="sp-grow"><span className="sp-t1 !text-[var(--mg-muted)]">Entries closed</span></span></div>
              ) : entryOptions(s, sectionFull(s)).map((o) => (
                <Link
                  key={o.kind}
                  className="sp-row"
                  to={user ? chooseHref(s.id, o.kind) : '/login'}
                  state={user ? { from: cameFrom } : { from: chooseHref(s.id, o.kind) }}
                  onClick={() => setSent(null)}
                >
                  <span className="sp-grow"><span className="sp-t1">{o.label}</span>{o.sub && <span className="sp-t2">{o.sub}</span>}</span>
                  <span className="ev-price">{feeText(o.priceMinor)}</span>
                  <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                </Link>
              ))}
            </div>
          </section>
        ))}
        {atHome && <p className="sp-note">The timetable, toplists and live scores open once the teams are drawn.</p>}
      </>
    );
  }

  return (
    <div className="rf-page mx-auto flex w-full max-w-xl flex-col pb-4 pt-3">
      <h1 className="sr-only">Enter {competition.name}</h1>
      <EntryStepper labels={labels} current={current} />
      {body}
    </div>
  );
}
