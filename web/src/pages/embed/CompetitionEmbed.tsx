import { Fragment, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useEmbedResource } from '../../hooks/useEmbedResource';
import {
  EMBED_VIEWS, embedHomePath, embedPollMs, isCompetitionDetail, isStandingRows, parseEmbedOptions, recentHeatResults,
  timetableGroupTitle, timetableRowDay, visibleTimetableGroups, type EmbedView,
} from '../../lib/embed';
import { displaySectionName } from '../../lib/section';
import { computeTimings, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { groupRowsBySession, sessionOrdinals, statusLabel, TIMETABLE_COLOURS, timetableRows, type TimetableRow } from '../../lib/timetableRows';
import { buildToplist, toplistNote } from '../../lib/toplist';
import type { CompetitionDetail, StandingRow } from '../../types';
import { EmbedFrame, EmbedMessage, StaleNotice } from './EmbedFrame';

const FIRST_RESULTS = 8;

/** One competition's standings, latest results or timetable. Public data only: team names, places, points and times. */
export function CompetitionEmbed({ view }: { view: EmbedView }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const options = useMemo(() => parseEmbedOptions(search), [search]);
  const valid = id !== undefined && /^[1-9]\d{0,8}$/.test(id);
  const competitionId = valid ? Number(id) : null;
  const target = { kind: 'competition', id: competitionId ?? 0 } as const;
  const homeHref = embedHomePath(target, view);

  const competition = useEmbedResource<CompetitionDetail>(
    valid ? `/competitions/${id}` : null,
    isCompetitionDetail,
    (data, failures) => embedPollMs(!!data?.sessions.some((s) => s.status === 1), failures),
  );
  const [picked, setPicked] = useState<number | null>(null);
  const data = competition.data;
  const fixed = data?.sections.find((s) => s.id === options.section)?.id ?? null;
  const sectionId = fixed ?? (view === 'standings' ? data?.sections.find((s) => s.id === picked)?.id ?? data?.sections[0]?.id ?? null : null);
  const live = !!data?.sessions.some((s) => s.status === 1);

  const standings = useEmbedResource<StandingRow[]>(
    view === 'standings' && valid && sectionId != null ? `/competitions/${id}/standings?sectionId=${sectionId}` : null,
    isStandingRows,
    (_standings, failures) => embedPollMs(live, failures),
  );

  const viewLabel = EMBED_VIEWS.find((v) => v.id === view)?.label ?? '';
  const sectionName = data?.sections.find((s) => s.id === fixed);
  const subtitle = [viewLabel, fixed != null ? displaySectionName(sectionName?.displayName) : ''].filter(Boolean).join(' · ');
  const frame = { options, homeHref, title: data?.name ?? 'Mounted Games', subtitle: data ? subtitle : undefined, updatedAt: competition.updatedAt };

  if (!valid || competition.error === 'notfound') return <EmbedFrame {...frame}><EmbedMessage>This competition isn’t available.</EmbedMessage></EmbedFrame>;
  if (!data) {
    return <EmbedFrame {...frame}>
      {competition.error ? <EmbedMessage onRetry={competition.reload}>Couldn’t load the results. Check the connection and try again.</EmbedMessage> : <EmbedMessage>Loading…</EmbedMessage>}
    </EmbedFrame>;
  }
  return <EmbedFrame {...frame}>
    {competition.error && <StaleNotice />}
    {view === 'standings' && <StandingsView competition={data} sectionId={sectionId} fixed={fixed != null} onPick={setPicked} standings={standings.data} failed={!!standings.error && !standings.data} retry={standings.reload} />}
    {view === 'results' && <ResultsView competition={data} sectionId={fixed} />}
    {view === 'timetable' && <TimetableView competition={data} sectionId={fixed} />}
  </EmbedFrame>;
}

function StandingsView({ competition, sectionId, fixed, onPick, standings, failed, retry }: {
  competition: CompetitionDetail;
  sectionId: number | null;
  fixed: boolean;
  onPick: (id: number) => void;
  standings: StandingRow[] | null;
  failed: boolean;
  retry: () => void;
}) {
  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const list = useMemo(
    () => (standings && sectionId != null ? buildToplist(standings, competition.sessions, competition.teams, sectionId, section?.finalistCount) : null),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );
  if (sectionId == null) return <EmbedMessage>No age groups yet.</EmbedMessage>;
  return <>
    {!fixed && competition.sections.length > 1 && (
      <div className="emb-chips" role="group" aria-label="Age group">
        {competition.sections.map((s) => <button key={s.id} type="button" className="emb-chip" aria-pressed={s.id === sectionId} onClick={() => onPick(s.id)}>{displaySectionName(s.displayName)}</button>)}
      </div>
    )}
    {failed && <EmbedMessage onRetry={retry}>Couldn’t load the standings.</EmbedMessage>}
    {!failed && !list && <EmbedMessage>Loading…</EmbedMessage>}
    {list && list.rows.length === 0 && list.hc.length === 0 && <EmbedMessage>No results yet.</EmbedMessage>}
    {list && (list.rows.length > 0 || list.hc.length > 0) && <>
      {section?.finalistCount ? <p className="emb-note">Top {section.finalistCount} make the final</p> : null}
      <ol className="emb-list" aria-label="Standings">
        {list.rows.map((row, index) => {
          const note = toplistNote(row);
          return <Fragment key={row.teamId}>
            <li className="emb-row">
              <span className="emb-pos">{row.position}<span className="sr-only">{row.joint ? ' (joint)' : ''}</span></span>
              <span className="emb-name"><span>{row.teamName}</span>{note && <small>{note}</small>}</span>
              <span className="emb-pts">{row.points}<span className="sr-only"> points</span></span>
            </li>
            {list.cutAfter === index && index < list.rows.length - 1 && <li role="separator" aria-label="Final cut-off" className="emb-cut">Final cut-off</li>}
          </Fragment>;
        })}
        {list.hc.map((team) => (
          <li key={team.teamId} className="emb-row emb-row-hc">
            <span className="emb-pos">HC</span>
            <span className="emb-name"><span>{team.teamName}</span><small>Hors concours</small></span>
            <span className="emb-pts">{team.points}<span className="sr-only"> points</span></span>
          </li>
        ))}
      </ol>
    </>}
  </>;
}

function ResultsView({ competition, sectionId }: { competition: CompetitionDetail; sectionId: number | null }) {
  const heats = useMemo(() => recentHeatResults(competition.sessions, sectionId), [competition.sessions, sectionId]);
  const [shown, setShown] = useState(FIRST_RESULTS);
  if (heats.length === 0) return <EmbedMessage>No results yet.</EmbedMessage>;
  return <>
    {heats.slice(0, shown).map((heat) => (
      <section key={heat.key} aria-label={heat.title}>
        <h2 className="emb-h2"><span>{heat.title}</span>{!heat.complete && <em>In progress</em>}</h2>
        <ol className="emb-list" style={{ marginTop: 6 }}>
          {heat.rows.map((row) => (
            <li key={row.teamId} className="emb-row">
              <span className="emb-pos">{row.place ?? '–'}</span>
              <span className="emb-name"><span>{row.teamName}</span></span>
              <span className="emb-pts">{row.points ?? '–'}<span className="sr-only"> points</span></span>
            </li>
          ))}
        </ol>
      </section>
    ))}
    {heats.length > shown && <button type="button" className="emb-more" onClick={() => setShown((n) => n + FIRST_RESULTS)}>Show earlier results</button>}
  </>;
}

function TimetableView({ competition, sectionId }: { competition: CompetitionDetail; sectionId: number | null }) {
  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
  // Qualifier heats stay off the public timetable, so they stay off the widget.
  const rows = useMemo(
    () => timetableRows(competition.sessions, timings, false).filter((row) => sectionId == null || row.session.competitionSectionId === sectionId || row.session.competitionSectionId == null),
    [competition.sessions, timings, sectionId],
  );
  const startDay = dayKey(new Date(competition.startDate));
  const days = [...new Set(rows.map((row) => timetableRowDay(row, startDay)))].filter(Boolean).sort();
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const today = dayKey(new Date());
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : defaultTimetableDay(days, today);
  const dayRows = rows.filter((row) => timetableRowDay(row, startDay) === day);
  const groups = groupRowsBySession(dayRows);
  const shown = visibleTimetableGroups(groups, showAll);
  const arenas = new Set(dayRows.map((row) => row.session.arenaName?.trim()).filter(Boolean));

  if (rows.length === 0) return <EmbedMessage>The timetable isn’t published yet.</EmbedMessage>;
  return <>
    {days.length > 1 && (
      <div className="emb-chips" role="group" aria-label="Choose day">
        {days.map((d, index) => (
          <button key={d} type="button" className="emb-chip" aria-pressed={d === day} onClick={() => setPickedDay(d)}>
            {new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} · Day {index + 1}
          </button>
        ))}
      </div>
    )}
    {shown.map((group) => {
      const title = timetableGroupTitle(group, ordinals);
      return <section key={group.key} aria-label={title ?? group.session.name}>
        {title && <h2 className="emb-h2"><span>{title}</span></h2>}
        <ul className="emb-list" style={{ marginTop: title ? 6 : 0 }}>
          {group.rows.map((row) => <TimetableLine key={row.key} row={row} showArena={arenas.size > 1} />)}
        </ul>
      </section>;
    })}
    {(shown.length < groups.length || showAll) && groups.length > 1 && (
      <button type="button" className="emb-more" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide finished sessions' : 'Show the whole day'}</button>
    )}
    {groups.length === 0 && <EmbedMessage>Nothing scheduled for this day.</EmbedMessage>}
  </>;
}

function TimetableLine({ row, showArena }: { row: TimetableRow; showArena: boolean }) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const name = race ? (heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow') : session.name;
  const kindLabel = race ? '' : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const sub = [kindLabel, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  return (
    <li className={`emb-row ${status === 'live' ? 'emb-row-live' : status === 'finished' ? 'emb-row-finished' : ''}`}>
      <span className="emb-time">
        {delayMinutes > 0 && row.scheduled && <s><span className="sr-only">Planned </span>{formatTime(row.scheduled)}</s>}
        <span>{delayMinutes > 0 && row.scheduled && <span className="sr-only">, now </span>}{formatTime(row.effective)}</span>
      </span>
      <span className="emb-name"><span>{name}</span>{sub && <small>{sub}</small>}</span>
      <span className="emb-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
      <span className="emb-state">{statusLabel(status, delayMinutes)}</span>
    </li>
  );
}
