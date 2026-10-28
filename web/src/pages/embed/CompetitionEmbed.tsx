import { Fragment, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useEmbedResource } from '../../hooks/useEmbedResource';
import {
  embedHomePath, embedPollMs, isCompetitionDetail, isStandingRows, parseEmbedOptions, recentHeatResults,
  timetableGroupTitle, timetableRowDay, visibleTimetableGroups, type EmbedView,
} from '../../lib/embed';
import { displaySectionName } from '../../lib/section';
import { computeTimings, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { groupRowsBySession, sessionOrdinals, TIMETABLE_COLOURS, timetableRows, type TimetableRow } from '../../lib/timetableRows';
import { buildToplist } from '../../lib/toplist';
import { embedToplistNote, timetableStatusText } from '../../lib/embedText';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import type { CompetitionDetail, StandingRow } from '../../types';
import { EmbedFrame, EmbedMessage, StaleNotice } from './EmbedFrame';
import { formatPoints } from '../../lib/formatPoints';

const FIRST_RESULTS = 8;

/** One competition's standings, latest results or timetable. Public data only: team names, places, points and times. */
export function CompetitionEmbed({ view }: { view: EmbedView }) {
  const t = useT();
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

  const viewLabel = t(`screen.embed.view.${view}`);
  const sectionName = data?.sections.find((s) => s.id === fixed);
  const subtitle = [viewLabel, fixed != null ? displaySectionName(sectionName?.displayName) : ''].filter(Boolean).join(' · ');
  const frame = { options, homeHref, title: data?.name ?? t('common.mountedGames'), subtitle: data ? subtitle : undefined, updatedAt: competition.updatedAt };

  if (!valid || competition.error === 'notfound') return <EmbedFrame {...frame}><EmbedMessage>{t('screen.embed.competitionGone')}</EmbedMessage></EmbedFrame>;
  if (!data) {
    return <EmbedFrame {...frame}>
      {competition.error ? <EmbedMessage onRetry={competition.reload}>{t('screen.embed.loadFailed')}</EmbedMessage> : <EmbedMessage>{t('common.loading')}</EmbedMessage>}
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
  const t = useT();
  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const list = useMemo(
    () => (standings && sectionId != null ? buildToplist(standings, competition.sessions, competition.teams, sectionId, section?.finalistCount) : null),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );
  if (sectionId == null) return <EmbedMessage>{t('competition.scoring.noAgeGroups')}</EmbedMessage>;
  return <>
    {!fixed && competition.sections.length > 1 && (
      <div className="emb-chips" role="group" aria-label={t('screen.embed.ageGroup')}>
        {competition.sections.map((s) => <button key={s.id} type="button" className="emb-chip" aria-pressed={s.id === sectionId} onClick={() => onPick(s.id)}>{displaySectionName(s.displayName)}</button>)}
      </div>
    )}
    {failed && <EmbedMessage onRetry={retry}>{t('screen.embed.standingsFailed')}</EmbedMessage>}
    {!failed && !list && <EmbedMessage>{t('common.loading')}</EmbedMessage>}
    {list && list.rows.length === 0 && list.hc.length === 0 && <EmbedMessage>{t('screen.embed.noResults')}</EmbedMessage>}
    {list && (list.rows.length > 0 || list.hc.length > 0) && <>
      {section?.finalistCount ? <p className="emb-note">{t('screen.embed.topMake', { count: section.finalistCount })}</p> : null}
      <ol className="emb-list" aria-label={t('screen.embed.standingsLabel')}>
        {list.rows.map((row, index) => {
          const note = embedToplistNote(row, t);
          return <Fragment key={row.teamId}>
            <li className="emb-row">
              <span className="emb-pos">{row.position}<span className="sr-only">{row.joint ? ` ${t('screen.embed.joint')}` : ''}</span></span>
              <span className="emb-name"><span>{row.teamName}</span>{note && <small>{note}</small>}</span>
              <span className="emb-pts">{formatPoints(row.points)}<span className="sr-only"> {t('screen.embed.points')}</span></span>
            </li>
            {list.cutAfter === index && index < list.rows.length - 1 && <li role="separator" aria-label={t('screen.embed.cutoff')} className="emb-cut">{t('screen.embed.cutoff')}</li>}
          </Fragment>;
        })}
        {list.hc.map((team) => (
          <li key={team.teamId} className="emb-row emb-row-hc">
            <span className="emb-pos">{t('screen.embed.hcShort')}</span>
            <span className="emb-name"><span>{team.teamName}</span><small>{t('screen.embed.horsConcours')}</small></span>
            <span className="emb-pts">{formatPoints(team.points)}<span className="sr-only"> {t('screen.embed.points')}</span></span>
          </li>
        ))}
      </ol>
    </>}
  </>;
}

function ResultsView({ competition, sectionId }: { competition: CompetitionDetail; sectionId: number | null }) {
  const t = useT();
  const heats = useMemo(() => recentHeatResults(competition.sessions, sectionId), [competition.sessions, sectionId]);
  const [shown, setShown] = useState(FIRST_RESULTS);
  if (heats.length === 0) return <EmbedMessage>{t('screen.embed.noResults')}</EmbedMessage>;
  return <>
    {heats.slice(0, shown).map((heat) => (
      <section key={heat.key} aria-label={heat.title}>
        <h2 className="emb-h2"><span>{heat.title}</span>{!heat.complete && <em>{t('screen.embed.inProgress')}</em>}</h2>
        <ol className="emb-list" style={{ marginTop: 6 }}>
          {heat.rows.map((row) => (
            <li key={row.teamId} className="emb-row">
              <span className="emb-pos">{row.place ?? '–'}</span>
              <span className="emb-name"><span>{row.teamName}</span></span>
              <span className="emb-pts">{row.points == null ? '–' : formatPoints(row.points)}<span className="sr-only"> {t('screen.embed.points')}</span></span>
            </li>
          ))}
        </ol>
      </section>
    ))}
    {heats.length > shown && <button type="button" className="emb-more" onClick={() => setShown((n) => n + FIRST_RESULTS)}>{t('screen.embed.showEarlier')}</button>}
  </>;
}

function TimetableView({ competition, sectionId }: { competition: CompetitionDetail; sectionId: number | null }) {
  const t = useT();
  const { locale } = useLanguage();
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

  if (rows.length === 0) return <EmbedMessage>{t('screen.embed.timetableNotPublished')}</EmbedMessage>;
  return <>
    {days.length > 1 && (
      <div className="emb-chips" role="group" aria-label={t('screen.embed.chooseDay')}>
        {days.map((d, index) => (
          <button key={d} type="button" className="emb-chip" aria-pressed={d === day} onClick={() => setPickedDay(d)}>
            {new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })} · {t('screen.embed.dayN', { n: index + 1 })}
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
      <button type="button" className="emb-more" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? t('screen.embed.hideFinished') : t('screen.embed.showWholeDay')}</button>
    )}
    {groups.length === 0 && <EmbedMessage>{t('competition.timetable.empty')}</EmbedMessage>}
  </>;
}

function TimetableLine({ row, showArena }: { row: TimetableRow; showArena: boolean }) {
  const t = useT();
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const name = race ? (heat ? heat.label || t('competition.timetable.heat', { n: row.heatIndex + 1 }) : t('competition.timetable.heatsToFollow')) : session.name;
  const kindLabel = race ? '' : session.kind === 2 ? t('competition.timetable.briefing') : session.isBreak || session.kind === 1 ? t('competition.timetable.break') : session.location || '';
  const sub = [kindLabel, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  return (
    <li className={`emb-row ${status === 'live' ? 'emb-row-live' : status === 'finished' ? 'emb-row-finished' : ''}`}>
      <span className="emb-time">
        {delayMinutes > 0 && row.scheduled && <s><span className="sr-only">{t('screen.embed.planned')} </span>{formatTime(row.scheduled)}</s>}
        <span>{delayMinutes > 0 && row.scheduled && <span className="sr-only">, {t('screen.embed.now')} </span>}{formatTime(row.effective)}</span>
      </span>
      <span className="emb-name"><span>{name}</span>{sub && <small>{sub}</small>}</span>
      <span className="emb-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
      <span className="emb-state">{timetableStatusText(status, delayMinutes, t)}</span>
    </li>
  );
}
