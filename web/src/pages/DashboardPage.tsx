import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Trophy, Users, ClipboardList, Timer,
  Sparkles, MessagesSquare, Flag, Radio, Info, CreditCard,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import type { CompetitionSummary, CompetitionDetail } from '../types';

type GlobalCard = { to: string; label: string; icon: typeof Trophy; needsAuth?: boolean; hideForAdmin?: boolean };
const globalCards: GlobalCard[] = [
  { to: '/competitions', label: 'Competitions', icon: Trophy },
  { to: '/teams', label: 'My Teams', icon: Users, needsAuth: true },
  { to: '/declarations', label: 'Dec Forms', icon: ClipboardList, needsAuth: true },
  { to: '/me/signups', label: 'My Signups', icon: CreditCard, needsAuth: true, hideForAdmin: true },
  { to: '/chat', label: 'Live Feed', icon: MessagesSquare },
];

type SectionCard = { sub: string; label: string; icon: typeof Trophy };
const competitionSections: SectionCard[] = [
  { sub: '', label: 'Timetable', icon: Timer },
  { sub: 'scoring', label: 'Age group', icon: Flag },
  { sub: 'chat', label: 'Live Feed · Stream', icon: Radio },
  { sub: 'details', label: 'Details', icon: Info },
];

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const { current } = useCurrentCompetition();
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  // The detail is stored with the competition it was fetched for, so it is ignored once focus moves on.
  const [focused, setFocused] = useState<{ id: number; detail: CompetitionDetail | null } | null>(null);

  useEffect(() => {
    api.get<CompetitionSummary[]>('/competitions').then((r) => setCompetitions(r.data)).catch(() => {});
  }, []);

  const active = competitions.find((c) => c.isActive && !c.isArchived);
  const focusId = current?.id ?? active?.id ?? null;

  const focusedDetail = focused != null && focused.id === focusId ? focused.detail : null;

  useEffect(() => {
    if (focusId == null) return;
    let cancelled = false;
    api.get<CompetitionDetail>(`/competitions/${focusId}`)
      .then((r) => { if (!cancelled) setFocused({ id: focusId, detail: r.data }); })
      .catch(() => { if (!cancelled) setFocused({ id: focusId, detail: null }); });
    return () => { cancelled = true; };
  }, [focusId]);

  const isAdmin = hasRole('Admin');
  const cards = globalCards.filter((c) => {
    if (c.needsAuth && user == null) return false;
    if (c.hideForAdmin && isAdmin) return false;
    return true;
  });

  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-4 py-4">
      <motion.section
        initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="mg-card flex items-center gap-3 p-3"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[rgb(var(--mg-header))] text-white">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="mg-h1 mg-h1-sm truncate">
            {user
              ? `Welcome back, ${user.fullName.split(' ')[0]} 👋`
              : 'Mounted Games — live dashboard'}
          </h1>
          <p className="mg-meta truncate">
            {focusedDetail
              ? `${focusedDetail.name} ${focusedDetail.isActive ? 'is live today.' : ''}`
              : active ? `${active.name} is live today.` : 'No live competition right now.'}
          </p>
        </div>
        {focusId != null && (
          <Link to={`/competitions/${focusId}`} className="mg-btn mg-btn-primary !min-h-10 !px-3 !text-[15px] shrink-0">
            <Timer className="h-4 w-4" aria-hidden="true" /> Open
          </Link>
        )}
      </motion.section>

      <section className="space-y-2">
        {focusId != null && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {competitionSections.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  to={`/competitions/${focusId}${s.sub ? `/${s.sub}` : ''}`}
                  className="mg-card block p-2.5 hover:border-[rgb(var(--mg-heading))]"
                >
                  <s.icon className="mb-1.5 h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                  <h3 className="mg-h2 !text-base">{s.label}</h3>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <h2 className="mg-eyebrow pt-2">App</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cards.map((c, i) => (
            <motion.div
              key={c.to}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link to={c.to} className="mg-card block p-3 hover:border-[rgb(var(--mg-heading))]">
                <c.icon className="mb-2 h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                <h3 className="mg-h2 !text-base">{c.label}</h3>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mg-eyebrow mb-2">Recent competitions</h2>
        <div className="mg-card mg-list">
          {competitions.slice(0, 6).map((c) => (
            <Link key={c.id} to={`/competitions/${c.id}`} className="mg-row !min-h-12">
              <span className={`mg-badge ${c.isActive && !c.isArchived ? 'mg-badge-live' : 'mg-badge-outline'}`}>
                  {c.isActive && !c.isArchived ? 'Live' : c.isArchived ? 'Archived' : 'Past'}
                </span>
              <h3 className="flex-1 truncate font-semibold">{c.name}</h3>
              <span className="mg-meta shrink-0">
                {new Date(c.startDate).toLocaleDateString()}
              </span>
            </Link>
          ))}
          {competitions.length === 0 && (
            <div className="mg-lede p-3">
              No competitions yet. {user?.roles.includes('Admin') && (
                <Link to="/admin" className="font-semibold text-[rgb(var(--mg-heading))] underline">Create one →</Link>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

