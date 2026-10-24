import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Eye, MapPin, Megaphone } from 'lucide-react';
import type { CompetitionDetail, Heat, LiveStream, Session, StreamOverlay } from '../../types';
import { bannerShowsIn, parseLook, type OverlayLook, type OverlayPlace } from '../../lib/overlays';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import { statusLetter } from '../../lib/resultStatus';
import { formatPoints } from '../../lib/formatPoints';
import { useCompetition } from '../../pages/competition/context';
import { displaySectionName } from '../../lib/section';

export type LiveOverlayCardMode = 'none' | 'toplist' | 'heat' | 'lanes' | 'next';

const DATA_CARD_MODES = new Set<string>(['toplist', 'heat', 'lanes', 'next']);

function readLiveOverlayCard(overlay: StreamOverlay): { mode: LiveOverlayCardMode; sectionId: number | null } {
  const look = (overlay.look ?? {}) as Record<string, unknown>;
  const rawMode = typeof look.liveCard === 'string' ? look.liveCard : overlay.bannerText;
  const mode: LiveOverlayCardMode = rawMode === 'toplist' || rawMode === 'heat' || rawMode === 'lanes' || rawMode === 'next' ? rawMode : 'none';
  const sectionId = typeof look.liveSectionId === 'number' ? look.liveSectionId : null;
  return { mode, sectionId };
}

const CORNERS: Partial<Record<OverlayPlace, string>> = {
  'top-left': 'left-3 top-3', 'top-right': 'right-3 top-3', 'bottom-left': 'left-3 bottom-14', 'bottom-right': 'right-3 bottom-14',
};

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function ClockChip() {
  const time = useMinuteClock();
  return <span className="mg-ov-chip"><Clock aria-hidden="true" />{time}</span>;
}

/** The small corner pieces a producer can switch on: viewer count, arena, clock and logo. */
export function OverlayChips({ stream, look, live }: { stream: LiveStream; look: OverlayLook; live: ReactNode }) {
  // The LIVE badge always leads the top-left corner; the producer's chips join whichever corner they chose.
  const corners = new Map<string, ReactElement[]>([[CORNERS['top-left']!, [<span key="live">{live}</span>]]]);
  const add = (place: OverlayPlace, element: ReactElement) => {
    const corner = CORNERS[place];
    if (corner) corners.set(corner, [...(corners.get(corner) ?? []), element]);
  };
  const { logo, viewers, arena, clock } = look.elements;
  if (logo.show && look.logoUrl) add(logo.place, <img key="logo" className="mg-ov-logo" src={look.logoUrl} alt="" />);
  if (viewers.show) add(viewers.place, <span key="viewers" className="mg-ov-chip"><Eye aria-hidden="true" />{stream.viewerCount} watching</span>);
  if (arena.show) add(arena.place, <span key="arena" className="mg-ov-chip"><MapPin aria-hidden="true" />{stream.arenaName}</span>);
  if (clock.show) add(clock.place, <ClockChip key="clock" />);
  return <>{[...corners].map(([corner, items]) => (
    <div key={corner} className={`absolute flex flex-wrap items-center gap-2 ${corner}`}>{items}</div>
  ))}</>;
}

/** The producer's banner, in the chosen style and position, on streams from the arenas it's meant for. */
export function ProducerBanner({ stream, arenaName, overlay, look }: { stream?: LiveStream; arenaName?: string; overlay: StreamOverlay; look?: OverlayLook }) {
  const resolvedLook = look ?? parseLook(overlay.look);
  const targetArena = arenaName ?? stream?.arenaName ?? '';
  if (!resolvedLook.elements.banner.show || !bannerShowsIn(overlay, targetArena)) return null;
  const text = overlay.bannerText!;
  if (DATA_CARD_MODES.has(text)) return null;
  const edge = resolvedLook.elements.banner.place === 'top' ? 'top-12' : 'bottom-12';
  if (overlay.bannerStyle === 2) {
    return <div role="status" className="absolute inset-x-3 top-1/3 flex justify-center">
      <div className="mg-ov-alert mg-stream-fade"><AlertTriangle aria-hidden="true" /><strong>{text}</strong></div>
    </div>;
  }
  if (overlay.bannerStyle === 1) {
    return <div role="status" className={`mg-ov-lower mg-stream-fade absolute inset-x-0 ${edge}`}><Megaphone aria-hidden="true" /><span>{text}</span></div>;
  }
  return <div role="status" className={`mg-ov-ticker absolute inset-x-0 ${edge}`} aria-label={text}>
    <span aria-hidden="true">{text}</span>
  </div>;
}

/** The latest card for this stream's arena, while it's due on screen: from the delay until the delay plus its length. */
function useDueCard(cards: QueuedScoreCard[], arenaName: string, delayMs: number, defaultLengthMs: number): QueuedScoreCard | null {
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
export function ScoreCardOverlay({ stream, overlay, look, cards }: { stream: LiveStream; overlay: StreamOverlay; look: OverlayLook; cards: QueuedScoreCard[] }) {
  const due = useDueCard(cards, stream.arenaName, overlay.scoreCardDelaySeconds * 1000, overlay.scoreCardSeconds * 1000);
  if (!due || overlay.scoreCardMode === 2 || !look.elements.scoreCard.show) return null;
  const { card } = due;
  const where = look.elements.scoreCard.place === 'bottom' ? 'mg-ov-card-bottom' : 'mg-ov-card-right';
  return (
    <section className={`mg-ov-card mg-stream-fade ${where}`} aria-label={`Results: ${due.heading}`}>
      <header>
        <strong>{due.heading}</strong>
        <span>after {card.raceName} (race {card.raceNumber} of {card.raceCount})</span>
      </header>
      <ol>
        {card.rows.filter((row) => !due.hiddenTeamIds?.includes(row.teamId)).map((row) => (
          <li key={row.teamId}>
            <span className="mg-ov-card-place">{row.place}</span>
            <span className="mg-ov-card-team">{due.names?.[row.teamId] ?? row.teamName}</span>
            {row.change === 'up' && <ArrowUp className="mg-ov-card-up" aria-label="moved up" />}
            {row.change === 'down' && <ArrowDown className="mg-ov-card-down" aria-label="moved down" />}
            <span className={`mg-ov-card-added ${row.eliminated ? 'is-out' : ''}`}>{row.eliminated ? statusLetter(true, row.status) : row.sitOut ? 'S' : `+${row.added}`}</span>
            <span className="mg-ov-card-total">{formatPoints(row.total)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function useOptionalCompetition(): CompetitionDetail | null {
  try {
    return useCompetition().competition;
  } catch {
    return null;
  }
}

function activeArenaHeat(competition: CompetitionDetail, arenaName: string, mode: 'current' | 'next'): { session: Session; heat: Heat } | null {
  const arena = arenaName.trim().toLowerCase();
  const nonBreak = competition.sessions.filter((s) => !s.isBreak && s.heats.length > 0);
  const matching = nonBreak.filter((s) => !arena || !s.arenaName?.trim() || s.arenaName.trim().toLowerCase() === arena);
  const all = [...(matching.length > 0 ? matching : nonBreak)].sort((a, b) => a.orderIndex - b.orderIndex);
  const pairs = all.flatMap((session) => [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex).map((heat) => ({ session, heat })));
  if (pairs.length === 0) return null;
  const inProgressIdx = pairs.findIndex(({ session }) => session.status === 1);
  const unscoredIdx = pairs.findIndex(({ heat }) => heat.races.every((r) => r.results.length === 0));
  if (mode === 'next') {
    if (inProgressIdx >= 0 && pairs[inProgressIdx + 1]) return pairs[inProgressIdx + 1];
    return unscoredIdx >= 0 ? pairs[unscoredIdx] : pairs.at(-1)!;
  }
  if (inProgressIdx >= 0) return pairs[inProgressIdx];
  return unscoredIdx > 0 ? pairs[unscoredIdx - 1] : pairs[0];
}

/**
 * Live producer-selected overlay card (Toplist, Heat table, Starting lanes, or Up next).
 * Stored inside `overlay.look` (or `overlay.bannerText`) so all viewers and the broadcaster see it immediately.
 */
export function LiveDataCardOverlay({ arenaName, overlay }: { arenaName: string; overlay: StreamOverlay }) {
  const competition = useOptionalCompetition();
  if (!competition) return null;
  const { mode, sectionId } = readLiveOverlayCard(overlay);
  if (mode === 'none') return null;

  if (mode === 'toplist') {
    const active = activeArenaHeat(competition, arenaName, 'current');
    const secId = sectionId ?? active?.session.competitionSectionId ?? competition.sections[0]?.id ?? null;
    const section = competition.sections.find((s) => s.id === secId) ?? competition.sections[0];
    if (!section) return null;
    const points = new Map<number, number>();
    for (const session of competition.sessions) {
      if (session.competitionSectionId !== section.id) continue;
      for (const heat of session.heats) {
        for (const race of heat.races) {
          for (const res of race.results) {
            points.set(res.teamId, (points.get(res.teamId) ?? 0) + res.points);
          }
        }
      }
    }
    const teams = competition.teams
      .filter((t) => t.competitionSectionId === section.id && !t.isHorsConcours && !t.isWithdrawn)
      .map((t) => ({ id: t.id, name: t.displayName, pts: points.get(t.id) ?? 0 }))
      .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name))
      .slice(0, 8);
    const anyScored = teams.some((t) => t.pts > 0);
    return (
      <section className="mg-ov-card mg-stream-fade mg-ov-card-right" aria-label={`Live toplist: ${displaySectionName(section.displayName)}`}>
        <header>
          <strong>{displaySectionName(section.displayName)} · Toplist</strong>
          <span>{anyScored ? 'Current standings' : 'Before Race 1'}</span>
        </header>
        <ol>
          {teams.map((t) => {
            const place = anyScored ? teams.filter((o) => o.pts > t.pts).length + 1 : '—';
            return (
              <li key={t.id}>
                <span className="mg-ov-card-place">{place}</span>
                <span className="mg-ov-card-team">{t.name}</span>
                <span />
                <span />
                <span className="mg-ov-card-total">{formatPoints(t.pts)}</span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  const pair = activeArenaHeat(competition, arenaName, mode === 'next' ? 'next' : 'current');
  if (!pair) return null;
  const { session, heat } = pair;
  const secName = displaySectionName(session.sectionName || session.name);
  const heading = [secName, heat.label].filter(Boolean).join(' · ');

  if (mode === 'lanes' || mode === 'next') {
    const entries = [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex);
    return (
      <section className="mg-ov-card mg-stream-fade mg-ov-card-right" aria-label={`${mode === 'next' ? 'Up next' : 'Starting lanes'}: ${heading}`}>
        <header>
          <strong>{heading}</strong>
          <span>{mode === 'next' ? 'Up next in collecting ring' : 'Starting lanes'}</span>
        </header>
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="mg-ov-card-place">L{entry.laneIndex}</span>
              <span className="mg-ov-card-team">{entry.teamName}</span>
              <span />
              <span className="mg-ov-card-added">Lane {entry.laneIndex}</span>
              <span />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const scoredRaces = heat.races.filter((r) => r.results.length > 0);
  const lastRace = scoredRaces.at(-1);
  const rows = heat.entries
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
    <section className="mg-ov-card mg-stream-fade mg-ov-card-right" aria-label={`Heat table: ${heading}`}>
      <header>
        <strong>{heading}</strong>
        <span>{scoredRaces.length > 0 ? `After race ${scoredRaces.length} of ${heat.races.length}` : `${heat.races.length} races`}</span>
      </header>
      <ol>
        {rows.map((row, idx) => (
          <li key={row.teamId}>
            <span className="mg-ov-card-place">{scoredRaces.length > 0 ? idx + 1 : `L${row.lane}`}</span>
            <span className="mg-ov-card-team">{row.teamName}</span>
            <span />
            {row.last != null ? <span className={`mg-ov-card-added ${row.elim ? 'is-out' : ''}`}>{row.elim ? 'E' : `+${row.last}`}</span> : <span />}
            <span className="mg-ov-card-total">{formatPoints(row.pts)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
