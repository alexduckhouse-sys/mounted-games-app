import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCompetition } from './context';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { problemMessage } from '../../lib/apiError';
import { revealOrder, riderLines } from '../../lib/prizeGiving';
import { displaySectionName } from '../../lib/section';
import { buildToplist } from '../../lib/toplist';
import { localOrdinal as ordinal } from '../../lib/ordinalText';
import { useT } from '../../i18n/LanguageContext';
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
  const t = useT();
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
      .catch(() => { if (!cancelled) setLoadError(t('screen.pg.loadError')); });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, mayRun, attempt, t]);

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

  // The set-up lives in a sheet opened from the dock; with no dock (page on its own) it stays on the page.
  const [setupOpen, setSetupOpen] = useState(false);
  const docked = useDockAction(mayRun ? { label: t('screen.pg.setUpTitle'), icon: 'settings', onClick: () => setSetupOpen(true) } : null);

  if (!mayRun) {
    return (
      <RefinePage>
        <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel={t('screen.pg.backToStream')} context={competition.name} title={t('screen.pg.title')} />
        <p className="rf-note">{t('screen.pg.onlyOrganiser')}</p>
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
      setError({ text: problemMessage(caught, t('screen.pg.updateError')), retry: () => void step(next) });
    } finally {
      setSending(false);
    }
  }

  const upNext = shown < order.length ? order[shown] : null;
  const riders = upNext && forms ? riderLines(forms, upNext.teamId) : [];
  const given = order.slice(0, shown).reverse();
  const nextLabel = !upNext ? t('screen.pg.clearStream')
    : shown === order.length - 1 && upNext.place === 1 ? t('screen.pg.revealWinners')
      : t(upNext.joint ? 'screen.pg.revealJoint' : 'screen.pg.reveal', { place: ordinal(upNext.place) });

  const setup = (
    <>
      <RefineList as="div" label={t('screen.pg.setUpLabel')}>
        <RefineChoiceRow label={t('screen.pg.ageGroup')} value={String(sectionId ?? '')} disabled={shown > 0}
          options={sections.map((s) => ({ value: String(s.id), label: displaySectionName(s.displayName || s.ageGroup) }))}
          onChange={(value) => { setSectionId(Number(value)); setError(null); }} />
        <div className="rf-row">
          <span className="rf-grow rf-t1">{t('screen.pg.placesToGive')}</span>
          <RefineQty name={t('screen.pg.placeNoun')} value={count} max={30} disabled={shown > 0} onChange={(next) => setCount(Math.max(1, next))} />
        </div>
      </RefineList>
      {shown > 0 && <RefineNote>{t('screen.pg.clearToChange')}</RefineNote>}
    </>
  );

  return (
    <RefinePage className="pg-page">
      <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel={t('screen.pg.backToStream')} context={competition.name} title={t('screen.pg.title')} />

      {!docked && <RefineSection title={t('screen.pg.setUp')} />}
      {!docked && setup}

      <div className="pg-body">
        {loadError && <Notice actionLabel={t('common.tryAgain')} onAction={() => { setLoadError(null); setAttempt((n) => n + 1); }}>{loadError}</Notice>}
        {error && <Notice actionLabel={t('common.tryAgain')} onAction={error.retry} actionDisabled={sending}>{error.text}</Notice>}
        {unfinished && shown === 0 && <Notice tone="info">{t('screen.pg.unfinished', { section: sectionName })}</Notice>}
        {toplist && order.length === 0 && <Notice tone="info">{t('screen.pg.noPlaces', { section: sectionName })}</Notice>}
        {!toplist && !loadError && <p role="status" className="rf-note">{t('screen.pg.loadingToplist')}</p>}

        {order.length > 0 && (
          <section className="pg-up" aria-live="polite" aria-label={upNext ? t('screen.pg.upNextLabel') : t('screen.pg.doneLabel')}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={upNext ? upNext.teamId : 'done'} className="pg-up-card"
                initial={still ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={still ? undefined : { opacity: 0, x: -24, transition: { duration: 0.16 } }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                {upNext ? <>
                  <div className="pg-up-head">
                    <span className="pg-up-place">{t(upNext.joint ? 'screen.pg.upNextJoint' : 'screen.pg.upNext', { place: ordinal(upNext.place) })}</span>
                    <span className="pg-up-pts">{t('screen.pg.pts', { points: points(upNext.points) })}</span>
                  </div>
                  <div>
                    <div className="pg-up-team">{upNext.teamName}</div>
                    {clubOf(upNext.teamId) && <div className="pg-up-club">{clubOf(upNext.teamId)}</div>}
                  </div>
                  {forms === null
                    ? <p className="pg-up-club">{t('screen.pg.loadingRiders')}</p>
                    : riders.length > 0
                      ? (
                        <ul className="pg-riders" aria-label={t('screen.pg.ridersLabel')}>
                          {riders.map((line) => (
                            <li key={line.rider}><b>{line.rider}{line.reserve && <span className="pg-reserve">{t('teams.team.reserve')}</span>}</b><span>{line.pony ?? t('screen.pg.noPony')}</span></li>
                          ))}
                        </ul>
                      )
                      : <p className="pg-up-club">{t('screen.pg.noDec')}</p>}
                </> : <>
                  <div className="pg-up-head"><span className="pg-up-place">{t('screen.pg.allGiven')}</span></div>
                  <p className="pg-up-club">{t('screen.pg.championsStay')}</p>
                </>}
              </motion.div>
            </AnimatePresence>
          </section>
        )}

        {order.length > 0 && (
          <div className="pg-acts">
            <button type="button" className="rf-btn" disabled={sending || shown === 0} onClick={() => void step(shown - 1)}>{t('common.back')}</button>
            <button type="button" className="rf-btn rf-btn-primary" disabled={sending} onClick={() => void step(upNext ? shown + 1 : 0)}>{nextLabel}</button>
          </div>
        )}

        {given.length > 0 && (
          <section aria-label={t('screen.pg.placesGiven')}>
            <h2 className="pg-given-head">{t('screen.pg.onStream')}</h2>
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
      {docked && setupOpen && <Sheet title={t('screen.pg.setUpTitle')} onClose={() => setSetupOpen(false)}>{setup}</Sheet>}
    </RefinePage>
  );
}
