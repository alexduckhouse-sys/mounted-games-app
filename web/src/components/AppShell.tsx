import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Lock, Unlock, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { CompetitionPickerDialog } from '../competition/CompetitionPicker';
import { RememberCompetitionDialog } from '../competition/RememberCompetitionDialog';
import { PageLoadBoundary } from './PageLoadBoundary';
import { NavigationDrawer } from './NavigationDrawer';
import { TopBarTicker } from './TopBarTicker';

export function AppShell() {
  const { hasRole, editorMode, setEditorMode } = useAuth();
  const { current, rememberChoice, storageError } = useCurrentCompetition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const choosingCompetition = ['/', '/competitions', '/competitions/past'].includes(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3">
          <span className="flex shrink-0 items-center gap-1.5 text-lg font-bold text-brand-700 dark:text-brand-300">
            <span className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700" />MG
          </span>
          <TopBarTicker />
          {hasRole('Admin') && (
            <button onClick={() => setEditorMode(!editorMode)} className={`btn-ghost min-h-11 min-w-11 shrink-0 ${editorMode ? 'navigation-selected' : ''}`} aria-label={editorMode ? 'Switch to view mode' : 'Switch to edit mode'} aria-pressed={editorMode}>
              {editorMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
          )}
          <button onClick={() => setMenuOpen(true)} className="btn-ghost min-h-11 min-w-11 shrink-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-6 w-6" /></button>
        </div>
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
