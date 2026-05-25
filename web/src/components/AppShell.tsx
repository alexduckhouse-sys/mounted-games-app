import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Trophy, Users, ClipboardList, MessagesSquare,
  Settings, LogOut, Palette, LogIn, Eye, X, Timer, Flag, Lock, Unlock,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { THEMES, useTheme } from '../theme/ThemeContext';
import { WeatherBadge } from './WeatherBadge';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from './NavExtrasContext';

export function AppShell() {
  const { user, logout, hasRole, editorMode, setEditorMode } = useAuth();
  const { theme, setTheme } = useTheme();
  const { current, clear } = useCurrentCompetition();
  const { extras } = useNavExtras();
  const nav = useNavigate();

  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, show: true, live: false },
    ...(current
      ? [
          { to: `/competitions/${current.id}`, label: 'Timetable', icon: Timer, end: true, show: true, live: false },
          { to: `/competitions/${current.id}/scoring`, label: 'Scoring', icon: Flag, end: false, show: true, live: false },
        ]
      : []),
    { to: '/teams', label: 'My Teams', icon: Users, end: false, show: hasRole('Trainer') && !hasRole('Admin'), live: false },
    { to: '/declarations', label: 'Dec Forms', icon: ClipboardList, end: false, show: hasRole('Trainer') || hasRole('Admin'), live: false },
    { to: '/chat', label: 'Live Feed', icon: MessagesSquare, end: false, show: true, live: true },
    { to: '/admin', label: 'Admin', icon: Settings, end: false, show: hasRole('Admin'), live: false },
  ].filter((l) => l.show);

  const hasExtras = extras.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/60 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-3 py-1.5 flex items-center gap-2 sm:gap-3">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1.5 font-bold text-brand-700 dark:text-brand-300 text-base sm:text-lg"
          >
            <span className="inline-block w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft" />
            MG
          </motion.div>
          {current && (
            <button
              onClick={() => nav(`/competitions/${current.id}`)}
              className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 text-[11px] font-medium max-w-[160px] sm:max-w-[240px]"
              title={`Open ${current.name}`}
            >
              <Trophy className="w-3 h-3 shrink-0" />
              <span className="truncate">{current.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); clear(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clear(); } }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-brand-200/70 dark:hover:bg-brand-800/70"
                title="Clear current competition"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <WeatherBadge />
            {hasRole('Admin') && (
              <button
                onClick={() => setEditorMode(!editorMode)}
                className={`btn-ghost !py-1 !px-2 text-[11px] flex items-center gap-1 ${
                  editorMode
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200 ring-1 ring-rose-300 dark:ring-rose-700'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                }`}
                title={editorMode
                  ? 'Edit mode is ON — destructive admin controls visible. Click to switch to View only.'
                  : 'View only — destructive admin controls hidden. Click to enable Edit mode.'}
              >
                {editorMode ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span className="hidden sm:inline">{editorMode ? 'Edit mode' : 'View only'}</span>
              </button>
            )}
            <div className="relative group">
              <button className="btn-ghost !py-1.5 !px-2" title="Theme">
                <Palette className="w-4 h-4" />
              </button>
              <div className="absolute right-0 mt-2 hidden group-hover:block group-focus-within:block z-40 card p-2 min-w-[180px]">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      theme === t.id ? 'font-semibold text-brand-700 dark:text-brand-300' : ''
                    }`}
                  >
                    <span className="inline-block w-5 h-5 rounded-md border" style={{ background: t.swatch }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {user ? (
              <>
                <div className="hidden sm:flex flex-col text-right text-[11px] leading-tight">
                  <span className="font-semibold">{user.fullName}</span>
                  <span className="text-slate-500">{user.roles.join(' · ')}</span>
                </div>
                <button
                  onClick={() => { logout(); nav('/'); }}
                  className="btn-ghost !py-1.5 !px-2"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <span className="hidden md:flex items-center gap-1 text-[11px] text-slate-500">
                  <Eye className="w-3 h-3" /> Public
                </span>
                <Link to="/login" className="btn-primary !py-1.5 !px-2.5 text-xs">
                  <LogIn className="w-3.5 h-3.5" /> Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        <nav className="flex overflow-x-auto items-center gap-1 px-2 pb-1.5 max-w-5xl mx-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => {
                if (l.live) {
                  return `whitespace-nowrap flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition ${
                    isActive
                      ? 'bg-rose-600 text-white shadow-soft'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200 hover:bg-rose-200/80 dark:hover:bg-rose-800/60'
                  }`;
                }
                return `whitespace-nowrap flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-soft'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800'
                }`;
              }}
            >
              {l.live && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" aria-hidden />}
              <l.icon className="w-3.5 h-3.5" />
              {l.label}
            </NavLink>
          ))}
          {hasExtras && extras.map((x) => (
            <NavLink
              key={x.to}
              to={x.to}
              end={x.end}
              className={({ isActive }) =>
                `whitespace-nowrap flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-soft'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800'
                }`
              }
            >
              <x.icon className="w-3.5 h-3.5" />
              {x.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-3 py-3 sm:px-4 sm:py-5">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200/60 dark:border-slate-800 py-2 text-center text-[11px] text-slate-500">
        MG App · live mounted games dashboard
      </footer>
    </div>
  );
}
