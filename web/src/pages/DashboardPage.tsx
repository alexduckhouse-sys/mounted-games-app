import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Trophy, Users, ClipboardList, Timer,
  Sparkles, MessagesSquare, Flag, Radio, Info, CreditCard, ShoppingBag,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import type { CompetitionSummary, CompetitionDetail } from '../types';

type GlobalCard = { to: string; label: string; icon: typeof Trophy; accent: string; needsAuth?: boolean; hideForAdmin?: boolean };
const globalCards: GlobalCard[] = [
  { to: '/competitions', label: 'Competitions', icon: Trophy, accent: 'from-brand-400 to-brand-600' },
  { to: '/teams', label: 'My Teams', icon: Users, accent: 'from-sky-400 to-sky-600', needsAuth: true },
  { to: '/declarations', label: 'Dec Forms', icon: ClipboardList, accent: 'from-violet-400 to-violet-600', needsAuth: true },
  { to: '/me/signups', label: 'My Signups', icon: CreditCard, accent: 'from-emerald-400 to-emerald-600', needsAuth: true, hideForAdmin: true },
  { to: '/shop', label: 'Shop', icon: ShoppingBag, accent: 'from-amber-400 to-amber-600' },
  { to: '/chat', label: 'Live Feed', icon: MessagesSquare, accent: 'from-rose-400 to-rose-600' },
];

type SectionCard = { sub: string; label: string; icon: typeof Trophy; accent: string };
const competitionSections: SectionCard[] = [
  { sub: '', label: 'Timetable', icon: Timer, accent: 'from-emerald-400 to-emerald-600' },
  { sub: 'scoring', label: 'Scoring · Toplist', icon: Flag, accent: 'from-amber-400 to-amber-600' },
  { sub: 'chat', label: 'Live Feed · Stream', icon: Radio, accent: 'from-rose-400 to-rose-600' },
  { sub: 'details', label: 'Details', icon: Info, accent: 'from-slate-400 to-slate-600' },
];

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const { current } = useCurrentCompetition();
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [focusedDetail, setFocusedDetail] = useState<CompetitionDetail | null>(null);

  useEffect(() => {
    api.get<CompetitionSummary[]>('/competitions').then((r) => setCompetitions(r.data)).catch(() => {});
  }, []);

  const active = competitions.find((c) => c.isActive && !c.isArchived);
  const focusId = current?.id ?? active?.id ?? null;

  useEffect(() => {
    if (focusId == null) { setFocusedDetail(null); return; }
    api.get<CompetitionDetail>(`/competitions/${focusId}`)
      .then((r) => setFocusedDetail(r.data))
      .catch(() => setFocusedDetail(null));
  }, [focusId]);

  const isAdmin = hasRole('Admin');
  const cards = globalCards.filter((c) => {
    if (c.needsAuth && user == null) return false;
    if (c.hideForAdmin && isAdmin) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <motion.section
        initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="card p-3 sm:p-4 flex items-center gap-3"
      >
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white shadow-soft shrink-0">
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-bold truncate">
            {user
              ? `Welcome back, ${user.fullName.split(' ')[0]} 👋`
              : 'Mounted Games — live dashboard'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-300 truncate">
            {focusedDetail
              ? `${focusedDetail.name} ${focusedDetail.isActive ? 'is live today.' : ''}`
              : active ? `${active.name} is live today.` : 'No live competition right now.'}
          </p>
        </div>
        {focusId != null && (
          <Link to={`/competitions/${focusId}`} className="btn-primary !py-2 !px-3 text-sm shrink-0">
            <Timer className="w-4 h-4" /> Open
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
                  className="card p-2.5 block group hover:shadow-lg transition"
                >
                  <div className={`w-8 h-8 mb-1.5 rounded-lg bg-gradient-to-br ${s.accent} grid place-items-center text-white`}>
                    <s.icon className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="font-semibold text-xs sm:text-sm leading-tight">{s.label}</h3>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <h2 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 px-1 pt-2">
          App
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cards.map((c, i) => (
            <motion.div
              key={c.to}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link to={c.to} className="card p-3 block group hover:shadow-lg transition">
                <div className={`w-9 h-9 mb-2 rounded-lg bg-gradient-to-br ${c.accent} grid place-items-center text-white`}>
                  <c.icon className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm">{c.label}</h3>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-slate-600 dark:text-slate-300">Recent competitions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {competitions.slice(0, 6).map((c) => (
            <Link key={c.id} to={`/competitions/${c.id}`} className="card p-2 block hover:shadow-lg transition">
              <div className="flex items-center gap-2">
                <span className={`pill !py-0.5 !px-1.5 text-[10px] ${c.isActive && !c.isArchived ? 'bg-arena-live text-yellow-900' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
                  {c.isActive && !c.isArchived ? 'Live' : c.isArchived ? 'Archived' : 'Past'}
                </span>
                <h3 className="font-semibold text-xs sm:text-sm truncate flex-1">{c.name}</h3>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(c.startDate).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
          {competitions.length === 0 && (
            <div className="card p-3 text-sm text-slate-500 dark:text-slate-300">
              No competitions yet. {user?.roles.includes('Admin') && (
                <Link to="/admin" className="text-brand-600 dark:text-brand-300 font-medium">Create one →</Link>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

