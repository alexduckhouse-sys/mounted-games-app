import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Timer, Flag, Trophy, LogIn, LogOut, Radio, Info, ArrowLeftRight, X, Settings, Users, ClipboardList, CreditCard, LayoutDashboard, History, SlidersHorizontal, Bell, CloudSun, Pin } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { THEMES, useTheme } from '../theme/ThemeContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from './NavExtrasContext';
import { WeatherBadge } from './WeatherBadge';
import { useAgeGroups } from './AgeGroupsContext';

const WEATHER_KEY = 'mg.showWeather';

export function NavigationDrawer({ onClose, onChangeCompetition }: { onClose: () => void; onChangeCompetition: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { current, rememberChoice, setRememberChoice } = useCurrentCompetition();
  const { user, hasRole, logout } = useAuth();
  const { extras } = useNavExtras();
  const navigate = useNavigate();
  const ageGroups = useAgeGroups();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showWeather, setShowWeather] = useState(() => { try { return localStorage.getItem(WEATHER_KEY) === '1'; } catch { return false; } });
  function toggleWeather() {
    const next = !showWeather;
    setShowWeather(next);
    try { if (next) localStorage.setItem(WEATHER_KEY, '1'); else localStorage.removeItem(WEATHER_KEY); } catch { /* storage blocked */ }
  }
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
    { to: current ? `${base}/toplists` : '/competitions', label: 'Toplists', icon: Trophy, end: true },
    { to: current ? `${base}/chat` : '/chat', label: 'Live feed / stream', icon: Radio, end: true },
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
          </div>
          <button onClick={() => setSettingsOpen((v) => !v)} className={`btn-ghost min-h-11 min-w-11 ${settingsOpen ? 'navigation-selected' : ''}`} aria-label="Settings" aria-expanded={settingsOpen}><SlidersHorizontal className="h-5 w-5" /></button>
          <button autoFocus onClick={onClose} className="btn-ghost min-h-11 min-w-11" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        {settingsOpen && (
          <section aria-label="Settings" className="mb-4 space-y-4 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div role="group" aria-label="Colour theme" className="space-y-1">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Colour theme</h3>
              {THEMES.map((item) => (
                <button key={item.id} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-base ${theme === item.id ? 'navigation-selected' : 'hover:bg-brand-50 dark:hover:bg-slate-800'}`}>
                  <span className="h-5 w-5 rounded-md border" style={{ background: item.swatch }} />{item.label}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Options</h3>
              <SettingSwitch icon={CloudSun} label="Show weather" checked={showWeather} onChange={toggleWeather} />
              {current && <SettingSwitch icon={Pin} label="Remember this competition on this device" checked={rememberChoice === 'remember'} onChange={() => setRememberChoice(rememberChoice === 'remember' ? 'visit' : 'remember')} />}
              {user && <NavLink to="/teams" onClick={onClose} className={`${linkClass(false)} justify-between`}><span className="flex items-center gap-3"><Bell className="h-5 w-5 shrink-0" />Notifications</span><span className="text-sm text-slate-500 dark:text-slate-300">Set up in My teams</span></NavLink>}
            </div>
          </section>
        )}
        {showWeather && <div className="mb-4 flex min-h-12 items-center gap-3 rounded-xl bg-slate-100 px-4 py-2 dark:bg-slate-800"><CloudSun className="h-5 w-5 shrink-0" /><span className="font-medium">Weather</span><span className="ml-auto"><WeatherBadge /></span></div>}
        {current && ageGroups.competitionId === current.id && ageGroups.groups.length > 0 && (
          <nav aria-label="Age groups" className="mb-4 rounded-2xl border-2 border-brand-200 bg-brand-50 p-3 dark:border-brand-700 dark:bg-brand-900/40">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-200"><Flag className="h-4 w-4" />Age groups</h3>
            <div className="grid grid-cols-2 gap-2">
              {ageGroups.groups.map((group) => (
                <NavLink key={group.id} to={`${base}/scoring?section=${group.id}`} onClick={onClose} className={() => `flex min-h-12 items-center justify-center rounded-xl border-2 px-3 py-2 text-center text-base font-bold !no-underline hover:!no-underline ${location.pathname === `${base}/scoring` && (new URLSearchParams(location.search).get('section') === String(group.id) || (!location.search && group.id === ageGroups.groups[0].id)) ? 'navigation-selected border-transparent' : 'border-brand-300 bg-white text-brand-800 hover:bg-brand-100 dark:border-brand-600 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800'}`}>{group.name}</NavLink>
              ))}
            </div>
          </nav>
        )}
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map((item) => <NavLink key={item.label} to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => linkClass(isActive && (current !== null || item.to !== '/competitions'))}><item.icon className="h-5 w-5 shrink-0" />{item.label}</NavLink>)}
          <button onClick={onChangeCompetition} className={`${linkClass(false)} w-full text-left`}><ArrowLeftRight className="h-5 w-5 shrink-0" />Change competition</button>
          <NavLink to="/competitions/past" onClick={onClose} className={({ isActive }) => linkClass(isActive)}><History className="h-5 w-5 shrink-0" />Past competitions</NavLink>
          <NavLink to={current ? `${base}/details` : '/competitions'} end onClick={onClose} className={({ isActive }) => linkClass(isActive && current !== null)}><Info className="h-5 w-5 shrink-0" />Details</NavLink>
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

function SettingSwitch({ icon: Icon, label, checked, onChange }: { icon: typeof Bell; label: string; checked: boolean; onChange: () => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={onChange} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-2 text-left text-base font-medium text-slate-700 hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-slate-800">
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{label}</span>
      <span aria-hidden="true" className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}><span className={`h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} /></span>
    </button>
  );
}
