import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Trophy, Timer, Flag, Lock, Unlock, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { WeatherBadge } from './WeatherBadge';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { CompetitionPickerDialog } from '../competition/CompetitionPicker';
import { RememberCompetitionDialog } from '../competition/RememberCompetitionDialog';
import { PageLoadBoundary } from './PageLoadBoundary';
import { NavigationDrawer } from './NavigationDrawer';

export function AppShell() {
  const { hasRole, editorMode, setEditorMode } = useAuth();
  const { current, rememberChoice, storageError } = useCurrentCompetition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const choosingCompetition = ['/', '/competitions', '/competitions/past'].includes(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3">
          <span className="flex shrink-0 items-center gap-1.5 text-lg font-bold text-brand-700 dark:text-brand-300">
            <span className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700" />MG
          </span>
          {current && !choosingCompetition ? (
            <button onClick={() => navigate(`/competitions/${current.id}`)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-brand-100 px-3 text-left text-sm font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100" title={current.name}>
              <Trophy className="h-4 w-4 shrink-0" /><span className="truncate">{current.name}</span>
            </button>
          ) : <span className="flex-1" />}
          <WeatherBadge />
          {hasRole('Admin') && (
            <button onClick={() => setEditorMode(!editorMode)} className={`btn-ghost min-h-11 min-w-11 shrink-0 ${editorMode ? 'navigation-selected' : ''}`} aria-label={editorMode ? 'Switch to view mode' : 'Switch to edit mode'} aria-pressed={editorMode}>
              {editorMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
          )}
          <button onClick={() => setMenuOpen(true)} className="btn-ghost min-h-11 min-w-11 shrink-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-6 w-6" /></button>
        </div>
        {current && !choosingCompetition && (
          <nav aria-label="Competition views" className="mx-auto grid max-w-5xl grid-cols-2 gap-2 px-3 pb-2">
            {[{ to: `/competitions/${current.id}`, label: 'Timetable', icon: Timer, end: true }, { to: `/competitions/${current.id}/scoring`, label: 'Age group', icon: Flag, end: false }].map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold !no-underline hover:!no-underline ${isActive ? 'navigation-selected' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}><item.icon className="h-4 w-4" />{item.label}</NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-3 sm:px-4 sm:py-5">
        {storageError && <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{storageError}</p>}
        <PageLoadBoundary page={location.pathname}>
          <Suspense fallback={<p role="status" className="py-4 text-sm">Opening page…</p>}><Outlet /></Suspense>
        </PageLoadBoundary>
      </main>
      {menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} onChangeCompetition={() => { setMenuOpen(false); setPickerOpen(true); }} />}
      {pickerOpen && <CompetitionPickerDialog onClose={() => setPickerOpen(false)} />}
      {current && !choosingCompetition && rememberChoice === 'ask' && !pickerOpen && !menuOpen && <RememberCompetitionDialog />}
    </div>
  );
}
