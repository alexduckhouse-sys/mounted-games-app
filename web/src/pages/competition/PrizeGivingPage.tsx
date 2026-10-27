import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCompetition } from './context';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { problemMessage } from '../../lib/apiError';
import { revealOrder, riderLines } from '../../lib/prizeGiving';
import { displaySectionName } from '../../lib/section';
import { buildToplist, ordinal } from '../../lib/toplist';
import { useStillMotion } from '../../lite/useStillMotion';
import { RefineChoiceRow, RefineHeader, RefineList, RefineNote, RefinePage, RefineQty, RefineSection } from '../refine/Refine';
import type { DeclarationForm, StandingRow } from '../../types';
import './prizeGiving.css';

const DEFAULT_PLACES = 6;
const points = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * The organiser's remote for a prize-giving: choose the age group and how many places to give, then reveal them from
 * last to first. Each place goes up on the live stream as it is read out (see PrizeGivingOverlay); the winners get the
 * champions' moment. The phone also shows each team's riders and ponies to read out, which the stream never shows.
 */
export function PrizeGivingPage() {
  const { competition } = useCompetition();
  const [params] = useSearchParams();
  const still = useStillMotion();
  const sections = competition.sections ?? [];
  const asked = Number(params.get('section'));
  const [sectionId, setSectionId] = useState<number | null>(sections.some((s) => s.id === asked) ? asked : sections[0]?.id ?? null);
  const [count, setCount] = useState(DEFAULT_PLACES);
  const [standings, setStandings] = useState<{ sectionId: number; rows: StandingRow[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [shown, setShown] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null);
  const { canOrganise } = useAuth();
  const mayRun = canOrganise(competition);

  useEffect(() => {
    if (sectionId == null || !mayRun) return;
    let cancelled = false;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then(({ data }) => { if (!cancelled) { setStandings({ sectionId, rows: Array.isArray(data) ? data : [] }); setLoadError(null); } })
      .catch(() => { if (!cancelled) setLoadError('Couldn’t load the toplist for this age group. Check your signal and try again.'); });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, mayRun, attempt]);

  useEffect(() => {
    if (!mayRun) return;
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then(({ data }) => { if (!cancelled) setForms(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setForms([]); });
    return () => { cancelled = true; };
  }, [competition.id, mayRun]);

  const section = sections.find((s) => s.id === sectionId);
  const sectionName = displaySectionName(section?.displayName || section?.ageGroup || '');
  const rows = standings?.sectionId === sectionId ? standings.rows : null;
  const toplist = useMemo(
    () => (rows && sectionId != null ? buildToplist(rows, competition.sessions, competition.teams, sectionId, section?.finalistCount) : null),
    [rows, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );
  const order = useMemo(() => (toplist ? revealOrder(toplist, count) : []), [toplist, count]);
  const clubOf = (teamId: number) => rows?.find((row) => row.teamId === teamId)?.clubName || null;
  const unfinished = toplist ? toplist.rows.some((row) => row.racesLeft > 0) : false;

  if (!mayRun) {
    return (
      <RefinePage>
        <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel="Back to live stream" context={competition.name} title="Prize-giving" />
        <p className="rf-note">Only the competition organiser or team can run the prize-giving.</p>
      </RefinePage>
    );
  }

  /** Puts the first `next` places on the stream (none clears it), and moves the phone on once the stream has them. */
  async function step(next: number) {
    if (sectionId == null) return;
    setSending(true);
    setError(null);
    try {
      if (next === 0) await api.post(`/competitions/${competition.id}/overlays/prize-giving`, { action: 'clear' });
      else {
        const given = order.slice(0, next);
        await api.post(`/competitions/${competition.id}/overlays/prize-giving`, {
          action: 'show',
          sectionId,
          places: given.map((place) => ({ teamId: place.teamId, place: place.place, points: place.points })),
          champions: next === order.length && given[given.length - 1].place === 1,
        });
      }
      setShown(next);
    } catch (caught) {
      setError({ text: problemMessage(caught, 'Couldn’t update the stream. Check your signal and try again.'), retry: () => void step(next) });
    } finally {
      setSending(false);
    }
  }

  const upNext = shown < order.length ? order[shown] : null;
  const riders = upNext && forms ? riderLines(forms, upNext.teamId) : [];
  const given = order.slice(0, shown).reverse();
  const nextLabel = !upNext ? 'Clear the stream'
    : shown === order.length - 1 && upNext.place === 1 ? 'Reveal the winners'
      : `Reveal ${upNext.joint ? 'joint ' : ''}${ordinal(upNext.place)}`;

  return (
    <RefinePage className="pg-page">
      <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel="Back to live stream" context={competition.name} title="Prize-giving" />

      <RefineSection title="Set up" />
      <RefineList as="div" label="Prize-giving set-up">
        <RefineChoiceRow label="Age group" value={String(sectionId ?? '')} disabled={shown > 0}
          options={sections.map((s) => ({ value: String(s.id), label: displaySectionName(s.displayName || s.ageGroup) }))}
          onChange={(value) => { setSectionId(Number(value)); setError(null); }} />
        <div className="rf-row">
          <span className="rf-grow rf-t1">Places to give</span>
          <RefineQty name="place" value={count} max={30} disabled={shown > 0} onChange={(next) => setCount(Math.max(1, next))} />
        </div>
      </RefineList>
      {shown > 0 && <RefineNote>Clear the stream to change the age group or the number of places.</RefineNote>}

      <div className="pg-body">
        {loadError && <Notice actionLabel="Try again" onAction={() => { setLoadError(null); setAttempt((n) => n + 1); }}>{loadError}</Notice>}
        {error && <Notice actionLabel="Try again" onAction={error.retry} actionDisabled={sending}>{error.text}</Notice>}
        {unfinished && shown === 0 && <Notice tone="info">Some races in {sectionName} aren’t scored yet, so these places could still change.</Notice>}
        {toplist && order.length === 0 && <Notice tone="info">No places to give in {sectionName} yet.</Notice>}
        {!toplist && !loadError && <p role="status" className="rf-note">Loading the toplist…</p>}

        {order.length > 0 && (
          <section className="pg-up" aria-live="polite" aria-label={upNext ? 'Up next' : 'Prize-giving done'}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={upNext ? upNext.teamId : 'done'} className="pg-up-card"
                initial={still ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={still ? undefined : { opacity: 0, x: -24, transition: { duration: 0.16 } }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                {upNext ? <>
                  <div className="pg-up-head">
                    <span className="pg-up-place">Up next: {upNext.joint ? 'joint ' : ''}{ordinal(upNext.place)}</span>
                    <span className="pg-up-pts">{points(upNext.points)} pts</span>
                  </div>
                  <div>
                    <div className="pg-up-team">{upNext.teamName}</div>
                    {clubOf(upNext.teamId) && <div className="pg-up-club">{clubOf(upNext.teamId)}</div>}
                  </div>
                  {forms === null
                    ? <p className="pg-up-club">Loading riders…</p>
                    : riders.length > 0
                      ? (
                        <ul className="pg-riders" aria-label="Riders and ponies">
                          {riders.map((line) => (
                            <li key={line.rider}><b>{line.rider}{line.reserve && <span className="pg-reserve">Reserve</span>}</b><span>{line.pony ?? 'No pony named'}</span></li>
                          ))}
                        </ul>
                      )
                      : <p className="pg-up-club">No dec form for this team, so no riders to read out.</p>}
                </> : <>
                  <div className="pg-up-head"><span className="pg-up-place">All places given</span></div>
                  <p className="pg-up-club">The champions stay on the stream until you clear it.</p>
                </>}
              </motion.div>
            </AnimatePresence>
          </section>
        )}

        {order.length > 0 && (
          <div className="pg-acts">
            <button type="button" className="rf-btn" disabled={sending || shown === 0} onClick={() => void step(shown - 1)}>Back</button>
            <button type="button" className="rf-btn rf-btn-primary" disabled={sending} onClick={() => void step(upNext ? shown + 1 : 0)}>{nextLabel}</button>
          </div>
        )}

        {given.length > 0 && (
          <section aria-label="Places given">
            <h2 className="pg-given-head">On the stream</h2>
            <ul className="pg-given">
              {given.map((place, index) => (
                <li key={place.teamId} className={index === 0 ? 'mg-arrive' : undefined}>
                  <span>{ordinal(place.place)}</span><b>{place.teamName}</b><span>{points(place.points)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </RefinePage>
  );
}
