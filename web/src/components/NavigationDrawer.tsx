import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Timer, Flag, Trophy, LogIn, LogOut, Radio, Info, ArrowLeftRight, X, Settings, Users, ClipboardList, CreditCard, LayoutDashboard, History, Palette, Pin } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { THEMES, useTheme } from '../theme/ThemeContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from './NavExtrasContext';
import { WeatherBadge } from './WeatherBadge';

export function NavigationDrawer({ onClose, onChangeCompetition }: { onClose: () => void; onChangeCompetition: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { current, rememberChoice, setRememberChoice } = useCurrentCompetition();
  const { user, hasRole, logout } = useAuth();
  const { extras } = useNavExtras();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; };
  }, []);
  const base = current ? `/competitions/${current.id}` : '/competitions';
  const links = [
    { to: base, label: 'Timetable', icon: Timer, end: true },
    { to: current ? `${base}/scoring` : '/competitions', label: 'Age group', icon: Flag, end: true },
    { to: current ? `${base}/toplists` : '/competitions', label: 'Toplists', icon: Trophy, end: true },
    { to: current ? `${base}/chat` : '/chat', label: 'Live feed / stream', icon: Radio, end: true },
    { to: current ? `${base}/details` : '/competitions', label: 'Details', icon: Info, end: true },
  ];
  const accountLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: !!user },
    { to: '/teams', label: 'My teams', icon: Users, show: hasRole('Trainer') && !hasRole('Admin') },
    { to: '/declarations', label: 'Dec forms', icon: ClipboardList, show: hasRole('Trainer') || hasRole('Admin') },
    { to: '/me/signups', label: 'My signups', icon: CreditCard, show: !!user && !hasRole('Admin') },
    { to: '/admin', label: 'Admin', icon: Settings, show: hasRole('Admin') },
  ].filter((item) => item.show);
  const linkClass = (active: boolean) => `flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-base font-medium !no-underline hover:!no-underline ${active ? 'navigation-selected' : 'text-slate-700 hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-slate-800'}`;
  return (
    <dialog ref={ref} onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="navigation-title" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(88vw,22rem)] max-w-none bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/50 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex min-h-full flex-col p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <h2 id="navigation-title" className="text-xl font-bold">Menu</h2>
            {current && <p className="mt-1 break-words text-sm font-medium text-slate-600 dark:text-slate-200">{current.name}</p>}
            {current && <div className="mt-2"><WeatherBadge /></div>}
          </div>
          <button onClick={() => setPaletteOpen((v) => !v)} className={`btn-ghost min-h-11 min-w-11 ${paletteOpen ? 'navigation-selected' : ''}`} aria-label="Choose colour theme" aria-expanded={paletteOpen}><Palette className="h-5 w-5" /></button>
          <button autoFocus onClick={onClose} className="btn-ghost min-h-11 min-w-11" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        {paletteOpen && (
          <div role="group" aria-label="Colour theme" className="mb-4 space-y-1 border-b border-slate-200 pb-3 dark:border-slate-700">
            {THEMES.map((item) => (
              <button key={item.id} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-base ${theme === item.id ? 'navigation-selected' : 'hover:bg-brand-50 dark:hover:bg-slate-800'}`}>
                <span className="h-5 w-5 rounded-md border" style={{ background: item.swatch }} />{item.label}
              </button>
            ))}
          </div>
        )}
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map((item) => <NavLink key={item.label} to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => linkClass(isActive && (current !== null || item.to !== '/competitions'))}><item.icon className="h-5 w-5 shrink-0" />{item.label}</NavLink>)}
          <button onClick={onChangeCompetition} className={`${linkClass(false)} w-full text-left`}><ArrowLeftRight className="h-5 w-5 shrink-0" />Change competition</button>
          {current && <button onClick={() => setRememberChoice(rememberChoice === 'remember' ? 'visit' : 'ask')} className={`${linkClass(false)} w-full text-left`}><Pin className="h-5 w-5 shrink-0" />{rememberChoice === 'remember' ? 'Stop remembering on this device' : 'Remember on this device'}</button>}
          <NavLink to="/competitions/past" onClick={onClose} className={({ isActive }) => linkClass(isActive)}><History className="h-5 w-5 shrink-0" />Past competitions</NavLink>
        </nav>
        {(accountLinks.length > 0 || extras.length > 0) && (
          <nav aria-label="Account and management" className="mt-4 space-y-1 border-t border-slate-200 pt-4 dark:border-slate-700">
            {accountLinks.map((item) => <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => linkClass(isActive)}><item.icon className="h-5 w-5 shrink-0" />{item.label}</NavLink>)}
            {extras.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => linkClass(isActive)}><item.icon className="h-5 w-5 shrink-0" />{item.label}</NavLink>)}
          </nav>
        )}
        <div className="mt-auto pt-4">
        {!user && <NavLink to="/login" onClick={onClose} className={({ isActive }) => linkClass(isActive)}><LogIn className="h-5 w-5 shrink-0" />Sign in</NavLink>}
        {user && <button className={`${linkClass(false)} w-full text-left`} onClick={() => { logout(); onClose(); navigate('/'); }}><LogOut className="h-5 w-5 shrink-0" />Sign out</button>}
        </div>
      </div>
    </dialog>
  );
}
