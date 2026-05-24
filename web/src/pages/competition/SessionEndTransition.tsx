import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, Coffee, X, Users, Phone } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionDetail, DeclarationForm, Session } from '../../types';
import { displaySectionName } from '../../lib/section';

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

export function SessionEndTransition({ competition, finishedSession, onClose, onAdvanced }: Props) {
  const nav = useNavigate();
  const { hasRole } = useAuth();
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const [busy, setBusy] = useState(false);

  const next = competition.sessions
    .filter((s) => s.orderIndex > finishedSession.orderIndex)
    .sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;

  const nextRealSession = competition.sessions
    .filter((s) => s.orderIndex > finishedSession.orderIndex && !s.isBreak)
    .sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;

  useEffect(() => {
    if (!nextRealSession) return;
    const target = nextRealSession;
    const teamIds = competition.teams
      .filter((t) => target.competitionSectionId == null || t.competitionSectionId === target.competitionSectionId)
      .map((t) => t.id);
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setForms(r.data.filter((f) => teamIds.includes(f.teamId))))
      .catch(() => setForms([]));
  }, [competition.id, competition.teams, nextRealSession?.id]);

  async function markFinished(session: Session) {
    await api.put(`/competitions/${competition.id}/sessions/${session.id}/status`, { status: 2 });
  }

  async function markInArena(session: Session) {
    await api.put(`/competitions/${competition.id}/sessions/${session.id}/status`, { status: 1 });
  }

  async function continueFlow() {
    if (!hasRole('Admin')) {
      onClose();
      return;
    }
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur flex items-center justify-center p-3"
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-card border border-slate-200 dark:border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-4 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm sm:text-base truncate">Session complete</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-300 truncate">{finishedSession.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!next ? (
            <div className="text-center py-6">
              <Trophy className="w-10 h-10 mx-auto text-amber-500 mb-2" />
              <p className="font-semibold">That was the final session.</p>
              <p className="text-sm text-slate-500 dark:text-slate-300">Check the standings to crown the winners.</p>
            </div>
          ) : next.isBreak ? (
            <div className="text-center py-3">
              <Coffee className="w-10 h-10 mx-auto text-amber-500 mb-2" />
              <p className="font-semibold text-lg">{next.name}</p>
              {next.durationMinutes && (
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Break for {next.durationMinutes} minutes
                </p>
              )}
              {nextRealSession && (
                <p className="text-xs text-slate-400 mt-3">
                  Next up after break: <span className="font-medium text-slate-600 dark:text-slate-200">{nextRealSession.name}</span>
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-300 mb-1">Up next</p>
              <h3 className="font-bold text-base">{next.name}</h3>
              {next.sectionName && <p className="text-xs text-slate-500 dark:text-slate-300">{displaySectionName(next.sectionName)}</p>}
            </div>
          )}

          {nextRealSession && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-300 flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5" /> Riders for {nextRealSession.name}
              </h4>
              {forms.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-300 italic">No declaration forms submitted yet for this session.</p>
              ) : (
                <ul className="space-y-2">
                  {forms.map((f) => (
                    <li key={f.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="font-semibold text-sm">{f.teamName}</span>
                        {f.submittedByName && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-300">
                            {f.submittedByName}
                            {f.submittedByPhone && (
                              <span className="inline-flex items-center gap-0.5 ml-1">
                                <Phone className="w-2.5 h-2.5" />{f.submittedByPhone}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {f.riders.map((r) => (
                          <li key={r.id} className="flex items-center gap-2 text-[11px]">
                            <span
                              className="inline-flex shrink-0 w-5 h-5 rounded-full items-center justify-center border text-[8px] font-bold uppercase"
                              style={{
                                background: bibSwatch(r.bibColour),
                                color: ['white', 'yellow'].includes((r.bibColour ?? '').toLowerCase()) ? '#111' : '#fff',
                                borderColor: bibSwatch(r.bibColour),
                              }}
                            >
                              {(r.bibColour ?? '—').slice(0, 2)}
                            </span>
                            <span className="font-medium truncate text-slate-900 dark:text-slate-50">{r.fullName}</span>
                            <span className="text-slate-500 dark:text-slate-300 truncate">{r.horseName ?? ''}</span>
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

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex gap-2 sticky bottom-0 bg-white dark:bg-slate-900">
          <button className="btn-ghost !py-2 !px-3 text-sm" onClick={onClose}>Stay here</button>
          <button
            className="btn-primary !py-2 !px-4 text-sm ml-auto"
            onClick={continueFlow}
            disabled={busy}
          >
            {next?.isBreak ? <Coffee className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            {!next ? 'Done' : next.isBreak ? 'Start break' : 'Continue'}
          </button>
        </div>
      </motion.div>
    </motion.div>
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
