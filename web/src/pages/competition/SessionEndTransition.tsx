import { clubLabel } from '../../lib/clubName';
import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, Coffee, X, Users, Phone } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionDetail, DeclarationForm, Heat, Session } from '../../types';
import { displaySectionName } from '../../lib/section';
import { ordinal } from '../../lib/toplist';
import { publicRiderName } from '../../lib/riderNames';
import type { SpecialAward } from '../eventTools/resultsBookTypes';

const reserveTag = 'ml-1.5 inline-block rounded-[4px] border border-[rgb(var(--mg-rule))] px-1 text-[10px] font-semibold text-[rgb(var(--mg-muted))]';

interface Props {
  competition: CompetitionDetail;
  finishedSession: Session;
  onClose: () => void;
  onAdvanced: () => void;
}

function bibSwatch(name?: string | null): string {
  switch ((name ?? '').toLowerCase()) {
    case 'red': return '#dc2626';
    case 'yellow': return '#facc15';
    case 'blue': return '#2563eb';
    case 'green': return '#16a34a';
    case 'white': return '#f8fafc';
    case 'black': return '#1f2937';
    case 'orange': return '#f97316';
    case 'pink': return '#ec4899';
    case 'purple': return '#9333ea';
    default: return '#94a3b8';
  }
}

function isFinalHeat(session: Session, heat: Heat): boolean {
  const s = session as Session & { isFinal?: boolean };
  const h = heat as Heat & { isFinal?: boolean };
  return (
    s.isFinal === true ||
    h.isFinal === true ||
    heat.raceRoundStage === 2 ||
    /\bfinals?\b/i.test(heat.label ?? '') ||
    /\bfinals?\b/i.test(session.name)
  );
}

function isCompletedFinalHeat(session: Session, heat: Heat): boolean {
  if (!isFinalHeat(session, heat)) return false;
  return (
    !!heat.finishedAt ||
    heat.races.some((r) => r.results.length > 0) ||
    (heat.races.length > 0 && heat.races.every((r) => r.isComplete))
  );
}

function buildPrizeGivingOrder(heat: Heat) {
  const teamMap = new Map<number, { teamId: number; teamName: string; points: number; laneIndex: number }>();
  for (const entry of heat.entries) {
    teamMap.set(entry.teamId, {
      teamId: entry.teamId,
      teamName: entry.teamName,
      points: 0,
      laneIndex: entry.laneIndex,
    });
  }
  for (const race of heat.races) {
    for (const res of race.results) {
      const existing = teamMap.get(res.teamId);
      if (existing) {
        existing.points += res.points;
        if (!existing.teamName && res.teamName) existing.teamName = res.teamName;
      } else {
        teamMap.set(res.teamId, {
          teamId: res.teamId,
          teamName: res.teamName,
          points: res.points,
          laneIndex: Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }
  const firstToLast = [...teamMap.values()].sort(
    (a, b) => b.points - a.points || a.laneIndex - b.laneIndex || a.teamName.localeCompare(b.teamName),
  );
  const withPlaces = firstToLast.map((item) => ({
    ...item,
    place: firstToLast.findIndex((other) => other.points === item.points) + 1,
  }));
  return [...withPlaces].reverse();
}

export function SessionEndTransition({ competition, finishedSession, onClose, onAdvanced }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, 'button[aria-label="Close"]');
  const nav = useNavigate();
  const { canManage } = useAuth();
  const [allForms, setAllForms] = useState<DeclarationForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [awards, setAwards] = useState<SpecialAward[]>([]);
  const [awardsFailed, setAwardsFailed] = useState(false);

  // Arenas run side by side, so finishing a session moves on within its own arena only.
  // A session with no arena name counts as being in the one and only arena.
  const arenaOf = (s: Session) => s.arenaName?.trim() ?? '';
  const laterInArena = competition.sessions
    .filter((s) => s.orderIndex > finishedSession.orderIndex && arenaOf(s) === arenaOf(finishedSession))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const next = laterInArena[0] ?? null;
  const nextRealSession = laterInArena.find((s) => !s.isBreak) ?? null;

  const completedFinalHeats = [...finishedSession.heats]
    .filter((h) => isCompletedFinalHeat(finishedSession, h))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const hasFinalHeats = completedFinalHeats.length > 0;

  const nextRealSessionId = nextRealSession?.id;
  const nextRealSectionId = nextRealSession?.competitionSectionId;
  useEffect(() => {
    if (nextRealSessionId == null && !hasFinalHeats) return;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setAllForms(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAllForms([]));
  }, [competition.id, nextRealSessionId, hasFinalHeats]);

  // Event-wide awards belong to the end of the whole event, so they show once, on its last session.
  const isLastSession = competition.sessions.every((s) => s.orderIndex <= finishedSession.orderIndex);
  const wantAwards = hasFinalHeats || isLastSession;
  useEffect(() => {
    if (!wantAwards) return;
    let cancelled = false;
    api.get<SpecialAward[]>(`/event-tools/competitions/${competition.id}/awards`)
      .then((r) => {
        if (cancelled) return;
        setAwardsFailed(false);
        setAwards(Array.isArray(r.data) ? r.data.filter((a) => a && typeof a.title === 'string' && typeof a.recipient === 'string') : []);
      })
      .catch(() => { if (!cancelled) setAwardsFailed(true); });
    return () => { cancelled = true; };
  }, [competition.id, wantAwards]);
  const sectionId = finishedSession.competitionSectionId;
  const sectionAwards = hasFinalHeats && sectionId != null ? awards.filter((a) => a.competitionSectionId === sectionId) : [];
  const eventAwards = isLastSession ? awards.filter((a) => a.competitionSectionId == null) : [];

  const nextSessionTeamIds = competition.teams
    .filter((t) => nextRealSectionId == null || t.competitionSectionId === nextRealSectionId)
    .map((t) => t.id);
  const forms = allForms.filter((f) => nextSessionTeamIds.includes(f.teamId));

  async function markFinished(session: Session) {
    await api.put(`/competitions/${competition.id}/sessions/${session.id}/status`, { status: 2 });
  }

  async function markInArena(session: Session) {
    await api.put(`/competitions/${competition.id}/sessions/${session.id}/status`, { status: 1 });
  }

  async function continueFlow() {
    if (!canManage(competition)) {
      onClose();
      return;
    }
    setBusy(true);
    setAdvanceError(null);
    try {
      if (finishedSession.status !== 2) {
        await markFinished(finishedSession);
      }
      if (next) {
        if (next.isBreak) {
          await markInArena(next);
        } else {
          await markInArena(next);
          nav(`/competitions/${competition.id}/session/${next.id}`);
        }
      }
      onAdvanced();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setAdvanceError(msg || "Couldn't move to the next session. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--mg-overlay)/0.6)] p-3 backdrop-blur"
    >
      <motion.div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label="Session complete"
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="mg-card max-h-[90vh] w-full max-w-2xl overflow-y-auto !rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] p-4">
          <CheckCircle2 className="h-5 w-5 text-[rgb(var(--mg-ok))]" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-[rgb(var(--mg-heading))] sm:text-base">Session complete</h2>
            <p className="truncate text-[11px] text-[rgb(var(--mg-muted))]">{finishedSession.name}</p>
          </div>
          <button onClick={onClose} className="mg-icon-btn !h-9 !w-9" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {advanceError && <Notice>{advanceError}</Notice>}
          {completedFinalHeats.length > 0 && (
            <div className="space-y-3" aria-label="Prize giving">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--mg-late-ink))]">
                <Trophy className="h-4 w-4" /> Prize Giving (Last to First)
              </h3>
              {completedFinalHeats.map((heat) => {
                const finalLabel = /\bfinals?\b/i.test(heat.label?.trim() ?? '')
                  ? heat.label!.trim()
                  : [finishedSession.name, heat.label?.trim()].filter(Boolean).join(' · ');
                const rows = buildPrizeGivingOrder(heat);
                return (
                  <section
                    key={heat.id}
                    aria-label={finalLabel}
                    className="space-y-2 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-3"
                  >
                    <h4 className="text-sm font-bold text-[rgb(var(--mg-heading))]">{finalLabel}</h4>
                    <ol className="space-y-2">
                      {rows.map((row) => {
                        const team = competition.teams.find((t) => t.id === row.teamId);
                        const form = allForms.find((f) => f.teamId === row.teamId);
                        const teamName = team?.displayName || row.teamName;
                        const clubName = clubLabel(team?.clubName) || null;
                        const trainerName =
                          form?.trainerName?.trim() ||
                          team?.trainerName?.trim() ||
                          form?.submittedByName?.trim() ||
                          null;
                        return (
                          <li
                            key={row.teamId}
                            className="space-y-1 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] p-2.5"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="flex min-w-0 items-baseline gap-2">
                                <span className="shrink-0 text-sm font-bold text-[rgb(var(--mg-late-ink))]">
                                  {ordinal(row.place)}
                                </span>
                                <span className="truncate text-sm font-semibold text-[rgb(var(--mg-ink))]">
                                  {teamName}
                                </span>
                                {clubName && (
                                  <span className="truncate text-xs text-[rgb(var(--mg-muted))]">
                                    {clubName}
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0 text-xs font-bold text-[rgb(var(--mg-heading))]">
                                {row.points} pts
                              </span>
                            </div>
                            {trainerName && (
                              <p className="text-xs text-[rgb(var(--mg-muted))]">
                                Trained by {trainerName}
                              </p>
                            )}
                            {form && form.riders.length > 0 && (
                              <ul className="grid grid-cols-1 gap-1 pt-0.5 sm:grid-cols-2">
                                {form.riders.map((r) => (
                                  <li key={r.id} className="text-xs text-[rgb(var(--mg-body))]">
                                    {publicRiderName(r)}
                                    {r.horseName?.trim() ? ` · ${r.horseName.trim()}` : ''}
                                    {r.isReserve && <span className={reserveTag}>Reserve</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
              <AwardList title="Special awards" awards={sectionAwards} />
            </div>
          )}
          {isLastSession && <AwardList title="Event awards" awards={eventAwards} />}
          {awardsFailed && (hasFinalHeats || isLastSession) && (
            <p role="status" className="text-xs italic text-[rgb(var(--mg-muted))]">Couldn’t load the special awards. Check your signal and reopen this.</p>
          )}

          {!next ? (
            <div className="py-6 text-center">
              <Trophy className="mx-auto mb-2 h-10 w-10 text-[rgb(var(--mg-late-time))]" />
              <p className="font-semibold text-[rgb(var(--mg-heading))]">That was the final session.</p>
              <p className="text-sm text-[rgb(var(--mg-muted))]">Check the standings to crown the winners.</p>
            </div>
          ) : next.isBreak ? (
            <div className="py-3 text-center">
              <Coffee className="mx-auto mb-2 h-10 w-10 text-[rgb(var(--mg-late-time))]" />
              <p className="text-lg font-semibold text-[rgb(var(--mg-heading))]">{next.name}</p>
              {next.durationMinutes && (
                <p className="text-sm text-[rgb(var(--mg-muted))]">
                  Break for {next.durationMinutes} minutes
                </p>
              )}
              {nextRealSession && (
                <p className="mt-3 text-xs text-[rgb(var(--mg-muted))]">
                  Next up after break: <span className="font-medium text-[rgb(var(--mg-ink))]">{nextRealSession.name}</span>
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-1 text-xs text-[rgb(var(--mg-muted))]">Up next</p>
              <h3 className="text-base font-bold text-[rgb(var(--mg-heading))]">{next.name}</h3>
              {next.sectionName && <p className="text-xs text-[rgb(var(--mg-muted))]">{displaySectionName(next.sectionName)}</p>}
            </div>
          )}

          {nextRealSession && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--mg-muted))]">
                <Users className="h-3.5 w-3.5" /> Riders for {nextRealSession.name}
              </h4>
              {forms.length === 0 ? (
                <p className="text-xs italic text-[rgb(var(--mg-muted))]">No declaration forms submitted yet for this session.</p>
              ) : (
                <ul className="space-y-2">
                  {forms.map((f) => (
                    <li key={f.id} className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] p-2">
                      <div className="mb-1.5 flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-[rgb(var(--mg-ink))]">{f.teamName}</span>
                        {f.submittedByName && (
                          <span className="text-[11px] text-[rgb(var(--mg-muted))]">
                            {f.submittedByName}
                            {f.submittedByPhone && (
                              <span className="ml-1 inline-flex items-center gap-0.5">
                                <Phone className="h-2.5 w-2.5" />{f.submittedByPhone}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {f.riders.map((r) => (
                          <li key={r.id} className="flex items-center gap-2 text-[11px]">
                            <span
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold uppercase"
                              style={{
                                background: bibSwatch(r.bibColour),
                                color: ['white', 'yellow'].includes((r.bibColour ?? '').toLowerCase()) ? '#111' : '#fff',
                                borderColor: bibSwatch(r.bibColour),
                              }}
                            >
                              {(r.bibColour ?? '—').slice(0, 2)}
                            </span>
                            <span className="truncate font-medium text-[rgb(var(--mg-ink))]">{publicRiderName(r)}</span>
                            {r.isReserve && <span className={reserveTag}>Reserve</span>}
                            <span className="truncate text-[rgb(var(--mg-muted))]">{r.horseName ?? ''}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <button className="mg-btn mg-btn-secondary !min-h-10 !px-3 !py-2 text-sm" onClick={onClose}>Stay here</button>
          <button
            className="mg-btn mg-btn-primary ml-auto !min-h-10 !px-4 !py-2 text-sm"
            onClick={continueFlow}
            disabled={busy}
          >
            {next?.isBreak ? <Coffee className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            {!next ? 'Done' : next.isBreak ? 'Start break' : 'Continue'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AwardList({ title, awards }: { title: string; awards: SpecialAward[] }) {
  if (awards.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-1.5 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-3">
      <h4 className="text-sm font-bold text-[rgb(var(--mg-heading))]">{title}</h4>
      <ul className="space-y-1">
        {awards.map((award) => (
          <li key={award.id} className="text-sm text-[rgb(var(--mg-ink))]">
            <span className="font-semibold">{award.title}</span>: {award.recipient}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Trophy({ className }: { className?: string }) {
  // Inlined Trophy icon so this file can be self-contained without re-importing
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
