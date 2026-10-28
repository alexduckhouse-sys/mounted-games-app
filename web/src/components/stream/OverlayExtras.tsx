import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Eye, MapPin, Megaphone } from 'lucide-react';
import { BibSwatch as BaseBibSwatch } from '../BibSwatch';
import type { CompetitionDetail, Heat, HeatEntry, LiveStream, Session, StandingRow, StreamOverlay, Team } from '../../types';
import { bannerShowsIn, parseLook, type OverlayLook, type OverlayPlace } from '../../lib/overlays';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import { statusLetter } from '../../lib/resultStatus';
import { formatPoints } from '../../lib/formatPoints';
import { useCompetition } from '../../pages/competition/context';
import { displaySectionName } from '../../lib/section';
import { api } from '../../api';
import { buildToplist } from '../../lib/toplist';
import { likelyWinners, parseFavouriteHistory, type FavouriteHistory } from '../../lib/likelyWinners';
import { readLiveOptions } from '../../lib/streamOverlayTiles';
import { computeTimings } from '../../lib/time';
import { timetableRows } from '../../lib/timetableRows';
import { EASE_OUT, ENTER, LEAVE, previousSlots, ROW_STAGGER_S, SHUFFLE_DELAY_S, SHUFFLE_S, SPRING, WIPE_HIDDEN_BOTTOM, WIPE_HIDDEN_LEFT, WIPE_HIDDEN_RIGHT, WIPE_SHOWN } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { currentLanes, type RaceLane } from '../../lib/raceLanes';
import { localHatbandName } from '../../lib/hatbands';
import { CountUp } from './CountUp';
import { TickerNumber } from '../TickerNumber';
import { playRankMoves, useRankMotion } from '../../hooks/useRankMotion';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';

interface BibColourHolder {
  bibColour?: string | null;
  bibColor?: string | null;
}

/** A broadcast bib swatch accepting colour/color and optional size, rendering nothing when no bib color exists. */
export function BibSwatch({
  colour,
  color,
  size,
  label,
  className = '',
}: {
  colour?: string | null;
  color?: string | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const resolved = colour ?? color;
  if (!resolved) return null;
  return (
    <span style={size ? { fontSize: `${size}px` } : undefined} className="inline-flex items-center">
      <BaseBibSwatch colour={resolved} label={label} className={className} />
    </span>
  );
}

export type LiveOverlayCardMode = 'none' | 'toplist' | 'heat' | 'lanes' | 'next' | 'favourites';

const DATA_CARD_MODES = new Set<string>(['toplist', 'heat', 'lanes', 'next']);

// eslint-disable-next-line react-refresh/only-export-components
export function readLiveOverlayCard(overlay: StreamOverlay): { mode: LiveOverlayCardMode; sectionId: number | null } {
  const look = (overlay.look ?? {}) as Record<string, unknown>;
  const rawMode = typeof look.liveCard === 'string' ? look.liveCard : overlay.bannerText;
  const mode: LiveOverlayCardMode = rawMode === 'toplist' || rawMode === 'heat' || rawMode === 'lanes' || rawMode === 'next' || rawMode === 'favourites' ? rawMode : 'none';
  const sectionId = typeof look.liveSectionId === 'number' ? look.liveSectionId : null;
  return { mode, sectionId };
}

const CORNERS: Partial<Record<OverlayPlace, string>> = {
  'top-left': 'left-3 top-3', 'top-right': 'right-3 top-3', 'bottom-left': 'left-3 bottom-14', 'bottom-right': 'right-3 bottom-14',
};

function useMinuteClock() {
  const { locale } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function ClockChip() {
  const time = useMinuteClock();
  return <span className="mg-ov-chip"><Clock aria-hidden="true" />{time}</span>;
}

/** The small corner pieces a producer can switch on: viewer count, arena, clock and logo. */
export function OverlayChips({ stream, look, live }: { stream: LiveStream; look: OverlayLook; live: ReactNode }) {
  const t = useT();
  // The LIVE badge always leads the top-left corner; the producer's chips join whichever corner they chose.
  const corners = new Map<string, ReactElement[]>([[CORNERS['top-left']!, [<span key="live">{live}</span>]]]);
  const add = (place: OverlayPlace, element: ReactElement) => {
    const corner = CORNERS[place];
    if (corner) corners.set(corner, [...(corners.get(corner) ?? []), element]);
  };
  const { logo, viewers, arena, clock } = look.elements;
  if (logo.show && look.logoUrl) add(logo.place, <img key="logo" className="mg-ov-logo" src={look.logoUrl} alt="" />);
  if (viewers.show) add(viewers.place, <span key="viewers" className="mg-ov-chip"><Eye aria-hidden="true" />{t('screen.ov.watching', { count: stream.viewerCount })}</span>);
  if (arena.show) add(arena.place, <span key="arena" className="mg-ov-chip"><MapPin aria-hidden="true" />{stream.arenaName}</span>);
  if (clock.show) add(clock.place, <ClockChip key="clock" />);
  return <>{[...corners].map(([corner, items]) => (
    <div key={corner} className={`absolute flex flex-wrap items-center gap-2 ${corner}`}>{items}</div>
  ))}</>;
}

/** The producer's banner, in the chosen style and position, on streams from the arenas it's meant for. */
export function ProducerBanner({ stream, arenaName, overlay, look }: { stream?: LiveStream; arenaName?: string; overlay: StreamOverlay; look?: OverlayLook }) {
  const still = useStillMotion();
  const resolvedLook = look ?? parseLook(overlay.look);
  const targetArena = arenaName ?? stream?.arenaName ?? '';
  const text = overlay.bannerText ?? '';
  const visible = resolvedLook.elements.banner.show && bannerShowsIn(overlay, targetArena) && !DATA_CARD_MODES.has(text);
  const edge = resolvedLook.elements.banner.place === 'top' ? 'top-12' : 'bottom-12';
  // A new message, style or position replaces the old banner: it leaves, then the new one comes in.
  const key = `${overlay.bannerStyle}|${edge}|${text}`;
  let banner: ReactElement | null = null;
  if (visible && overlay.bannerStyle === 2) {
    // Alert: lands with a little weight, and its accent ring pulses once.
    banner = (
      <motion.div
        key={key}
        role="status"
        aria-live="polite"
        initial={still ? false : { opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={still ? undefined : { opacity: 0, scale: 0.96, transition: LEAVE }}
        transition={SPRING}
        className="absolute inset-x-3 top-1/3 flex justify-center"
      >
        <div className={`mg-ov-alert ${still ? '' : 'mg-ov-alert-ring'}`}><AlertTriangle aria-hidden="true" /><strong>{text}</strong></div>
      </motion.div>
    );
  } else if (visible && overlay.bannerStyle === 1) {
    // Lower bar: the bar wipes on from its accent edge, the words follow, and it wipes off the far side.
    banner = (
      <motion.div
        key={key}
        role="status"
        aria-live="polite"
        initial={still ? false : { clipPath: WIPE_HIDDEN_LEFT }}
        animate={{ clipPath: WIPE_SHOWN }}
        exit={still ? undefined : { clipPath: WIPE_HIDDEN_RIGHT, transition: LEAVE }}
        transition={ENTER}
        className={`mg-ov-lower absolute inset-x-0 ${edge}`}
      >
        <Megaphone aria-hidden="true" />
        <motion.span initial={still ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...ENTER, delay: 0.14 }}>{text}</motion.span>
      </motion.div>
    );
  } else if (visible) {
    // Ticker: the band rises into place, then the words crawl.
    banner = (
      <motion.div
        key={key}
        role="status"
        aria-live="polite"
        initial={still ? false : { clipPath: WIPE_HIDDEN_BOTTOM }}
        animate={{ clipPath: WIPE_SHOWN }}
        exit={still ? undefined : { clipPath: WIPE_HIDDEN_BOTTOM, transition: LEAVE }}
        transition={ENTER}
        className={`mg-ov-ticker absolute inset-x-0 ${edge}`}
        aria-label={text}
      >
        <span aria-hidden="true">{text}</span>
      </motion.div>
    );
  }
  return <AnimatePresence mode="wait">{banner}</AnimatePresence>;
}

/** The latest card for this stream's arena, while it's due on screen: from the delay until the delay plus its length. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDueCard(cards: QueuedScoreCard[], arenaName: string, delayMs: number, defaultLengthMs: number): QueuedScoreCard | null {
  const arena = arenaName.trim();
  const card = cards.filter((c) => c.arenaName === '' || c.arenaName === arena).at(-1) ?? null;
  // A producer can change how long this card stays up.
  const lengthMs = card?.seconds ? card.seconds * 1000 : defaultLengthMs;
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!card) return;
    const show = card.receivedAt + delayMs;
    const hide = show + lengthMs;
    // The next edge after what's on screen now: showing, then hiding. A card already due shows at once.
    const next = now < show ? show : now < hide ? hide : null;
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [card, delayMs, lengthMs, now]);
  if (!card || now < card.receivedAt + delayMs || now >= card.receivedAt + delayMs + lengthMs) return null;
  return card;
}

/** The whole heat table after the race just scored, with what it added and who moved. */
export function ScoreCardOverlay({
  stream,
  overlay,
  look,
  cards,
  teams,
}: {
  stream: LiveStream;
  overlay: StreamOverlay;
  look: OverlayLook;
  cards: QueuedScoreCard[];
  teams?: Team[];
}) {
  const due = useDueCard(cards, stream.arenaName, overlay.scoreCardDelaySeconds * 1000, overlay.scoreCardSeconds * 1000);
  const optionalCompetition = useOptionalCompetition();
  const allTeams = teams ?? optionalCompetition?.teams;
  const visible = due !== null && overlay.scoreCardMode !== 2 && look.elements.scoreCard.show;
  const where = look.elements.scoreCard.place === 'bottom' ? 'mg-ov-card-bottom' : 'mg-ov-card-right';
  return (
    <AnimatePresence>
      {visible && due && <ScoreCardPanel key={`${due.card.raceId}-${due.receivedAt}`} due={due} teams={allTeams} where={where} />}
    </AnimatePresence>
  );
}

/**
 * The card itself. Rows arrive in the order they stood before this race, hold for a beat, then slide to their new
 * places while the totals count up and the points this race added pop in. The list is always in final order in
 * the page, so screen readers and copy-paste get the real table; only the drawing moves.
 */
function ScoreCardPanel({ due, teams, where }: { due: QueuedScoreCard; teams?: Team[]; where: string }) {
  const still = useStillMotion();
  const t = useT();
  const { card } = due;
  const rows = card.rows.filter((row) => !due.hiddenTeamIds?.includes(row.teamId));
  const before = previousSlots(rows);
  const settled = SHUFFLE_DELAY_S + SHUFFLE_S;
  // The card mounts with its rows already in their new order; play the climbs as the shuffle runs.
  const listRef = useRef<HTMLOListElement>(null);
  const beforeIds = [...before].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const nowKey = rows.map((row) => row.teamId).join(',');
  const beforeKey = beforeIds.join(',');
  useEffect(() => {
    if (still || !listRef.current) return;
    return playRankMoves(listRef.current, beforeKey.split(',').map(Number), nowKey.split(',').map(Number), { delayS: SHUFFLE_DELAY_S });
  }, [still, beforeKey, nowKey]);
  return (
    <CentreCard
      className={`${where} mg-ov-card-center`}
      label={t('screen.ov.results', { heading: due.heading })}
      heading={due.heading}
      subtitle={t('screen.ov.afterRace', { race: card.raceName, n: card.raceNumber, total: card.raceCount })}
    >
      <ol ref={listRef}>
        {rows.map((row, idx) => {
          const team = teams?.find((t) => t.id === row.teamId || t.displayName === row.teamName);
          const bibColor = team?.bibColour ?? (team as BibColourHolder | undefined)?.bibColor ?? (row as BibColourHolder).bibColour ?? (row as BibColourHolder).bibColor;
          // How many rows this team climbs (positive) or drops (negative) once the shuffle runs.
          const climb = (before.get(row.teamId) ?? idx) - idx;
          return (
            <motion.li
              key={row.teamId}
              data-rank-id={row.teamId}
              style={climb > 0 ? { position: 'relative', zIndex: 2 } : undefined}
              initial={still ? false : { opacity: 0, x: 12, y: `${climb * 100}%` }}
              animate={{ opacity: 1, x: 0, y: '0%' }}
              transition={{
                opacity: { delay: idx * ROW_STAGGER_S, duration: 0.2 },
                x: { ...SPRING, delay: idx * ROW_STAGGER_S },
                y: { delay: SHUFFLE_DELAY_S, duration: SHUFFLE_S, ease: EASE_OUT },
              }}
            >
              <span className="mg-ov-card-place">{row.place}</span>
              <span className="mg-ov-card-team" data-grow="start">
                {due.names?.[row.teamId] ?? row.teamName}
                {bibColor && <BibSwatch color={bibColor} size={10} />}
              </span>
              {row.change === 'up' && <motion.span initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTER, delay: settled }}><ArrowUp className="mg-ov-card-up" aria-label={t('screen.ov.movedUp')} /></motion.span>}
              {row.change === 'down' && <motion.span initial={still ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTER, delay: settled }}><ArrowDown className="mg-ov-card-down" aria-label={t('screen.ov.movedDown')} /></motion.span>}
              <motion.span
                className={`mg-ov-card-added ${row.eliminated ? 'is-out' : ''}`}
                initial={still ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...SPRING, delay: SHUFFLE_DELAY_S + idx * ROW_STAGGER_S }}
              >
                {row.eliminated ? statusLetter(true, row.status) : row.sitOut ? 'S' : `+${row.added}`}
              </motion.span>
              <span className="mg-ov-card-total" data-grow="end"><CountUp from={row.total - row.added} to={row.total} delay={SHUFFLE_DELAY_S} duration={SHUFFLE_S} format={formatPoints} /></span>
            </motion.li>
          );
        })}
      </ol>
    </CentreCard>
  );
}

/** The centred panel every overlay card uses: it lifts in, its accent rule draws across, and it drops away when replaced. */
function CentreCard({ className = 'mg-ov-card-right mg-ov-card-center', label, heading, subtitle, children }: {
  className?: string; label: string; heading: ReactNode; subtitle: ReactNode; children: ReactNode;
}) {
  const still = useStillMotion();
  return (
    <motion.section
      initial={still ? false : { opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? undefined : { opacity: 0, y: -10, scale: 0.98, transition: LEAVE }}
      transition={SPRING}
      className={`mg-ov-card ${className}`}
      aria-label={label}
    >
      <header>
        <strong>{heading}</strong>
        <span>{subtitle}</span>
      </header>
      <motion.span
        aria-hidden="true"
        className="mg-ov-card-rule"
        initial={still ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ ...ENTER, delay: 0.12 }}
      />
      {children}
    </motion.section>
  );
}

function useOptionalCompetition(): CompetitionDetail | null {
  try {
    return useCompetition().competition;
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function activeArenaHeat(competition: CompetitionDetail, arenaName: string, mode: 'current' | 'next'): { session: Session; heat: Heat } | null {
  const arena = arenaName.trim().toLowerCase();
  const sessions = competition.sessions.filter((session) =>
    (session.kind ?? (session.isBreak ? 1 : 0)) === 0 && (session.arenaName ?? '').trim().toLowerCase() === arena);
  const rows = timetableRows(sessions, computeTimings(sessions), true).filter((row) => row.heat !== null);
  const liveIndex = rows.findIndex((row) => row.status === 'live');
  const row = mode === 'next'
    ? rows.slice(liveIndex + 1).find((item) => item.status !== 'finished')
    : rows[liveIndex] ?? rows.find((item) => item.status !== 'finished') ?? rows.at(-1);
  return row?.heat ? { session: row.session, heat: row.heat } : null;
}

export function ToplistBody({
  competition,
  rows,
  started,
}: {
  competition: CompetitionDetail;
  rows: Array<{ teamId: number; teamName: string; position: number; points: number }>;
  started: boolean;
}) {
  const still = useStillMotion();
  const listRef = useRankMotion<HTMLOListElement>(rows.slice(0, 8).map((row) => row.teamId));
  return (
    <ol ref={listRef}>
      {rows.slice(0, 8).map((row, idx) => {
        const team = competition.teams.find((t) => t.id === row.teamId || t.displayName === row.teamName);
        const bibColor = team?.bibColour ?? (team as BibColourHolder | undefined)?.bibColor;
        return (
          <motion.li
            key={row.teamId}
            data-rank-id={row.teamId}
            layout="position"
            initial={still ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: still ? 0 : idx * ROW_STAGGER_S, layout: { duration: SHUFFLE_S, ease: EASE_OUT } }}
          >
            <span className="mg-ov-card-place">{started ? row.position : '—'}</span>
            <span className="mg-ov-card-team" data-grow="start">
              {row.teamName}
              {bibColor && <BibSwatch color={bibColor} size={10} />}
            </span>
            <span />
            <span />
            <span className="mg-ov-card-total" data-grow="end"><TickerNumber value={row.points} /></span>
          </motion.li>
        );
      })}
    </ol>
  );
}

function LiveToplistCard({ competition, sectionId }: { competition: CompetitionDetail; sectionId: number }) {
  const t = useT();
  const { ready } = useCompetition();
  const [result, setResult] = useState<{ rows: StandingRow[]; failed: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId }, signal: abort.signal })
      .then(({ data }) => {
        if (!Array.isArray(data) || data.some((row) => !row || !Number.isFinite(row.teamId) || typeof row.teamName !== 'string' || !Number.isFinite(row.totalPoints))) {
          throw new Error('Invalid standings');
        }
        if (!cancelled) setResult({ rows: data, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult((previous) => ({ rows: previous?.rows ?? [], failed: true }));
      });
    return () => { cancelled = true; abort.abort(); };
  }, [competition.id, competition.sessions, competition.teams, sectionId, ready]);
  const section = competition.sections.find((item) => item.id === sectionId)!;
  const hc = new Set(competition.teams.filter((team) => team.isHorsConcours).map((team) => team.id));
  const list = buildToplist((result?.rows ?? []).filter((row) => !hc.has(row.teamId)), competition.sessions, competition.teams, sectionId, null);
  const subtitle = result === null ? t('screen.ov.loadingStandings')
    : result.failed ? (list.rows.length > 0 ? t('screen.ov.lastStandings') : t('screen.ov.standingsUnavailable'))
      : list.started ? t('screen.ov.currentStandings') : t('screen.ov.beforeRace1');
  return (
    <CentreCard label={t('screen.ov.liveToplist', { section: displaySectionName(section.displayName) })} heading={t('screen.ov.toplistHeading', { section: displaySectionName(section.displayName) })} subtitle={subtitle}>
      <ToplistBody competition={competition} rows={list.rows} started={list.started} />
    </CentreCard>
  );
}

/**
 * Who is most likely to win the age group: the best average places, from this event's races and the teams' earlier
 * finishes (see lib/likelyWinners.ts). The figure is an average place, never odds. History is fetched once per age group;
 * if it can't be reached the card still ranks on this event alone.
 */
function LiveFavouritesCard({ competition, sectionId, rows }: { competition: CompetitionDetail; sectionId: number; rows: 3 | 5 }) {
  const still = useStillMotion();
  const [history, setHistory] = useState<{ sectionId: number; rows: FavouriteHistory[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    api.get<unknown>(`/stats/competitions/${competition.id}/favourites-history`, { params: { sectionId }, signal: abort.signal })
      .then(({ data }) => { if (!cancelled) setHistory({ sectionId, rows: parseFavouriteHistory(data) }); })
      .catch(() => { if (!cancelled) setHistory({ sectionId, rows: [] }); });
    return () => { cancelled = true; abort.abort(); };
  }, [competition.id, sectionId]);
  const section = competition.sections.find((item) => item.id === sectionId)!;
  const known = history?.sectionId === sectionId ? history.rows : [];
  const list = likelyWinners(competition.sessions, competition.teams, known, sectionId).slice(0, rows);
  const name = displaySectionName(section.displayName);
  return (
    <CentreCard label={`Favourites: ${name}`} heading={`${name} · Favourites`} subtitle={history === null ? 'Working it out…' : 'Best average place'}>
      {list.length === 0
        ? <p className="mg-ov-card-empty">No results to go on yet.</p>
        : (
          <ol>
            {list.map((row, idx) => (
              <motion.li key={row.teamId} initial={still ? false : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: still ? 0 : idx * ROW_STAGGER_S }}>
                <span className="mg-ov-card-place">{idx + 1}</span>
                <span className="mg-ov-card-team" data-grow="start">{row.teamName}</span>
                <span className="mg-ov-card-total" data-grow="end">avg place {row.avgPlace.toFixed(1)}</span>
                <span />
                <span />
              </motion.li>
            ))}
          </ol>
        )}
    </CentreCard>
  );
}

export function LanesBody({
  lanes,
  competition,
}: {
  lanes: RaceLane[];
  competition: CompetitionDetail;
}) {
  const still = useStillMotion();
  const t = useT();
  return (
    <ol>
      {lanes.map(({ entry, lane, sitting, hatband }, idx) => {
        const team = competition.teams.find((t) => t.id === entry.teamId || t.displayName === entry.teamName);
        const bibColor = team?.bibColour ?? (team as BibColourHolder | undefined)?.bibColor ?? entry.bibColour;
        return (
          <motion.li
            key={entry.id}
            initial={still ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: still ? 0 : idx * ROW_STAGGER_S, layout: { duration: SHUFFLE_S, ease: EASE_OUT } }}
          >
            <span className="mg-ov-card-place">{sitting ? 'S' : `L${lane}`}</span>
            <span className="mg-ov-card-team">
              {entry.teamName}
              {bibColor && <BibSwatch color={bibColor} size={10} />}
            </span>
            <span />
            <span className="mg-ov-card-added">{sitting ? t('screen.ov.sitsOut') : hatband ? t('screen.ov.hatband', { name: localHatbandName(hatband, t) }) : t('screen.ov.lane', { n: lane })}</span>
            <span />
          </motion.li>
        );
      })}
    </ol>
  );
}

export function NextBody({
  entries,
  competition,
}: {
  entries: HeatEntry[];
  competition: CompetitionDetail;
}) {
  const still = useStillMotion();
  const t = useT();
  return (
    <ol>
      {entries.map((entry, idx) => {
        const team = competition.teams.find((t) => t.id === entry.teamId || t.displayName === entry.teamName);
        const bibColor = team?.bibColour ?? (team as BibColourHolder | undefined)?.bibColor ?? entry.bibColour;
        return (
          <motion.li
            key={entry.id}
            initial={still ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: still ? 0 : idx * ROW_STAGGER_S, layout: { duration: SHUFFLE_S, ease: EASE_OUT } }}
          >
            <span className="mg-ov-card-place">L{entry.laneIndex}</span>
            <span className="mg-ov-card-team">
              {entry.teamName}
              {bibColor && <BibSwatch color={bibColor} size={10} />}
            </span>
            <span />
            <span className="mg-ov-card-added">{t('screen.ov.lane', { n: entry.laneIndex })}</span>
            <span />
          </motion.li>
        );
      })}
    </ol>
  );
}

export interface HeatRowData {
  teamId: number;
  teamName: string;
  lane: number;
  pts: number;
  last: number | null;
  elim: boolean;
}

export function HeatBody({
  rows,
  scored,
  competition,
}: {
  rows: HeatRowData[];
  scored: boolean;
  competition: CompetitionDetail;
}) {
  const still = useStillMotion();
  return (
    <ol>
      {rows.map((row, idx) => {
        const team = competition.teams.find((t) => t.id === row.teamId || t.displayName === row.teamName);
        const bibColor = team?.bibColour ?? (team as BibColourHolder | undefined)?.bibColor;
        return (
          <motion.li
            key={row.teamId}
            layout="position"
            initial={still ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: still ? 0 : idx * ROW_STAGGER_S, layout: { duration: SHUFFLE_S, ease: EASE_OUT } }}
          >
            <span className="mg-ov-card-place">{scored ? idx + 1 : `L${row.lane}`}</span>
            <span className="mg-ov-card-team">
              {row.teamName}
              {bibColor && <BibSwatch color={bibColor} size={10} />}
            </span>
            <span />
            {row.last != null ? <span className={`mg-ov-card-added ${row.elim ? 'is-out' : ''}`}>{row.elim ? 'E' : `+${row.last}`}</span> : <span />}
            <span className="mg-ov-card-total">{formatPoints(row.pts)}</span>
          </motion.li>
        );
      })}
    </ol>
  );
}

/**
 * Live producer-selected overlay card (Toplist, Heat table, Starting lanes, or Up next).
 * Stored inside `overlay.look` (or `overlay.bannerText`) so all viewers and the broadcaster see it immediately.
 * Switching card, section or heat lets the old card leave before the new one arrives.
 */
export function LiveDataCardOverlay({ arenaName, overlay }: { arenaName: string; overlay: StreamOverlay }) {
  const competition = useOptionalCompetition();
  const t = useT();
  return <AnimatePresence mode="wait">{competition ? liveDataCard(competition, arenaName, overlay, t) : null}</AnimatePresence>;
}

function liveDataCard(competition: CompetitionDetail, arenaName: string, overlay: StreamOverlay, t: Translate): ReactElement | null {
  const { mode, sectionId } = readLiveOverlayCard(overlay);
  if (mode === 'none') return null;

  if (mode === 'toplist') {
    const active = activeArenaHeat(competition, arenaName, 'current');
    const secId = sectionId ?? active?.session.competitionSectionId;
    const section = competition.sections.find((s) => s.id === secId);
    if (!section) return null;
    return <LiveToplistCard key={`toplist-${competition.id}-${section.id}`} competition={competition} sectionId={section.id} />;
  }

  if (mode === 'favourites') {
    const active = activeArenaHeat(competition, arenaName, 'current');
    const secId = sectionId ?? active?.session.competitionSectionId;
    const section = competition.sections.find((s) => s.id === secId);
    if (!section) return null;
    return <LiveFavouritesCard key={`favourites-${competition.id}-${section.id}`} competition={competition} sectionId={section.id} rows={readLiveOptions(overlay).favouritesRows} />;
  }

  const pair = activeArenaHeat(competition, arenaName, mode === 'next' ? 'next' : 'current');
  if (!pair) return null;
  const { session, heat } = pair;
  const secName = displaySectionName(session.sectionName || session.name);
  const heading = [secName, heat.label].filter(Boolean).join(' · ');

  if (mode === 'lanes' || mode === 'next') {
    const entries = [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex);
    const lanes = mode === 'lanes' ? currentLanes(competition, heat) : null;
    return (
      <CentreCard
        key={`${mode}-${heat.id}`}
        label={`${mode === 'next' ? t('screen.ov.upNext') : t('screen.ov.startingLanes')}: ${heading}`}
        heading={heading}
        subtitle={mode === 'next' ? t('screen.ov.upNextRing') : lanes?.raceName ? t('screen.ov.lanesFor', { race: lanes.raceName }) : t('screen.ov.startingLanes')}
      >
        {mode === 'next' ? (
          <NextBody entries={entries} competition={competition} />
        ) : (
          <LanesBody lanes={lanes?.lanes ?? entries.map((entry) => ({ entry, lane: String(entry.laneIndex), sitting: false, hatband: null }))} competition={competition} />
        )}
      </CentreCard>
    );
  }

  const scoredRaces = heat.races.filter((r) => r.results.length > 0);
  const lastRace = scoredRaces.at(-1);
  const rows: HeatRowData[] = heat.entries
    .map((e) => {
      let pts = 0;
      for (const race of scoredRaces) {
        for (const res of race.results) {
          if (res.teamId === e.teamId) pts += res.points;
        }
      }
      const lastRes = lastRace?.results.find((r) => r.teamId === e.teamId);
      return { teamId: e.teamId, teamName: e.teamName, lane: e.laneIndex, pts, last: lastRes ? lastRes.points : null, elim: Boolean(lastRes?.eliminated) };
    })
    .sort((a, b) => b.pts - a.pts || a.lane - b.lane);
  return (
    <CentreCard
      key={`heat-${heat.id}`}
      label={t('screen.ov.heatTable', { heading })}
      heading={heading}
      subtitle={scoredRaces.length > 0 ? t('screen.ov.afterRaceOf', { done: scoredRaces.length, total: heat.races.length }) : t('screen.ov.raceCount', { count: heat.races.length })}
    >
      <HeatBody rows={rows} scored={scoredRaces.length > 0} competition={competition} />
    </CentreCard>
  );
}
