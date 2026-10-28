import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mic } from 'lucide-react';
import { api } from '../../api';
import { buildCommentatorBriefing } from '../../lib/commentatorFacts';
import { formatPoints } from '../../lib/formatPoints';
import { useT } from '../../i18n/LanguageContext';
import type { CommentatorBriefing, DeclarationForm, Heat, Session, StandingRow, Team } from '../../types';

export interface BriefingLaneOrder {
  teamId: number;
  lane: string;
  sitting: boolean;
}

interface Props {
  competitionId: number;
  session: Session;
  heat: Heat;
  allSessions: readonly Session[];
  standings: readonly StandingRow[];
  teams: readonly Team[];
  declarations: readonly DeclarationForm[];
  finalistCount?: number | null;
  /** The desk's lane order for the race on now; the lane labels come from here. */
  laneOrder?: readonly BriefingLaneOrder[];
  /** Changes whenever the desk reloads from a live update. */
  refreshTick: number;
}

function isBriefing(data: unknown, heatId: number): data is CommentatorBriefing {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const b = data as Partial<CommentatorBriefing>;
  return b.heatId === heatId && Array.isArray(b.lanes) && Array.isArray(b.talkingPoints);
}

function startsOpen(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return false;
  }
}

export function CommentatorBriefingCard({
  competitionId, session, heat, allSessions, standings, teams, declarations, finalistCount, laneOrder, refreshTick,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(startsOpen);
  const [fetched, setFetched] = useState<{ key: string; briefing: CommentatorBriefing } | null>(null);
  const completedRaces = heat.races.filter((r) => r.isComplete).length;
  const key = `${competitionId}:${session.id}:${heat.id}:${completedRaces}:${refreshTick}`;

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let cancelled = false;
    api.get<unknown>(`/competitions/${competitionId}/sessions/${session.id}/heats/${heat.id}/commentator-briefing`)
      .then((r) => {
        if (!cancelled && isBriefing(r.data, heat.id)) setFetched({ key, briefing: r.data });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [competitionId, session.id, heat.id, key]);

  const local = useMemo(
    () => buildCommentatorBriefing({ competitionId, session, heat, standings, teams, allSessions, declarations, finalistCount }),
    [competitionId, session, heat, standings, teams, allSessions, declarations, finalistCount],
  );
  const briefing = fetched && fetched.key === key ? fetched.briefing : local;

  const laneByTeam = new Map((laneOrder ?? []).map((l) => [l.teamId, l]));
  // The desk's order is the source of truth; teams it doesn't list follow in drawn order.
  const position = (teamId: number, drawn: number) => {
    const at = (laneOrder ?? []).findIndex((l) => l.teamId === teamId);
    return at >= 0 ? at : 1000 + drawn;
  };
  const lanes = briefing.lanes.slice().sort((a, b) => position(a.teamId, a.laneIndex) - position(b.teamId, b.laneIndex));
  // Talking points name lanes as drawn ("Lane 1 (Oak A)"); say the lane each team rides in this race instead,
  // so the briefing agrees with the lanes card and the scorer.
  const laneLabel = (teamId: number, fallback: string) => {
    const order = laneByTeam.get(teamId);
    return order ? (order.sitting ? t('desk.commentary.sittingOut') : t('desk.commentary.lane', { n: order.lane })) : fallback;
  };
  const points = briefing.talkingPoints.slice(0, 6).map((point) => point.replace(/Lane (\d+) \(([^)]+)\)/g, (whole, _lane: string, name: string) => {
    const squad = briefing.lanes.find((l) => l.teamName === name);
    return squad ? `${laneLabel(squad.teamId, whole.split(' (')[0])} (${name})` : whole;
  }));

  return (
    <section aria-label={t('desk.commentary.briefing')} className="mg-card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="commentator-briefing-body"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Mic className="h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
          <span className="mg-display text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">{t('desk.commentary.briefing')}</span>
          <span className="truncate text-xs font-bold text-[rgb(var(--mg-body))]">
            {briefing.heatLabel}{briefing.currentRaceName ? ` · ${briefing.currentRaceName}` : ''}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))] ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id="commentator-briefing-body" className="flex flex-col gap-3 p-4">
          {briefing.biggestMoverHeadline && (
            <p className="m-0 rounded-lg bg-[rgb(var(--mg-tint))] px-3 py-2 text-sm font-bold text-[rgb(var(--mg-heading))]">
              {briefing.biggestMoverHeadline}
            </p>
          )}

          {points.length > 0 && (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-[rgb(var(--mg-ink))]">
              {points.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          {lanes.length === 0 ? (
            <p className="m-0 text-sm text-[rgb(var(--mg-muted))]">{t('desk.commentary.noLaneDrawBriefing')}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col divide-y divide-[rgb(var(--mg-rule-soft))] p-0">
              {lanes.map((l) => {
                const order = laneByTeam.get(l.teamId);
                const label = order ? (order.sitting ? t('desk.commentary.sitsOut') : t('desk.commentary.lane', { n: order.lane })) : t('desk.commentary.lane', { n: l.laneIndex });
                return (
                  <li key={l.teamId} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-bold text-[rgb(var(--mg-ink))]">
                        <span className="mg-display mr-2 text-[rgb(var(--mg-heading))]">{label}</span>
                        {l.teamName}
                      </span>
                      <span className="text-xs font-bold text-[rgb(var(--mg-heading))]">
                        {l.currentRank != null
                          ? t('desk.commentary.rankPts', { rank: l.currentRank, points: formatPoints(l.totalPoints) })
                          : t('desk.commentary.ptsOnly', { points: formatPoints(l.totalPoints) })}
                      </span>
                    </div>
                    {l.stakesHeadline && <p className="m-0 text-xs text-[rgb(var(--mg-body))]">{l.stakesHeadline}</p>}
                    {l.gameSpecialistNote && <p className="m-0 text-xs font-semibold text-[rgb(var(--mg-body))]">{l.gameSpecialistNote}</p>}
                    {l.ridersAndPonies.length > 0 && (
                      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                        {l.ridersAndPonies.map((r) => (
                          <li
                            key={r}
                            className="rounded-full border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--mg-body))]"
                          >
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
