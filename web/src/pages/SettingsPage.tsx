import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, CloudSun, Pin, PinOff, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { LiteModeSetting } from '../lite/LiteModeSetting';
import { THEMES } from '../theme/themes';
import { useTheme } from '../theme/ThemeContext';

const WEATHER_KEY = 'mg.showWeather';

const itemClass = (active: boolean) => `flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-base !no-underline hover:!no-underline ${active
  ? 'bg-[rgb(var(--mg-tint))] font-semibold text-[rgb(var(--mg-heading))]'
  : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`;
const iconClass = (active: boolean) => `h-5 w-5 shrink-0 ${active ? '' : 'text-[rgb(var(--mg-muted))]'}`;

export function SettingsPage() {
  usePageHeader({ title: 'Settings', plain: true });
  const { current, rememberChoice, setRememberChoice, forget } = useCurrentCompetition();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [showWeather, setShowWeather] = useState(() => {
    try { return localStorage.getItem(WEATHER_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (location.hash === '#lite-mode') {
      document.getElementById('lite-mode')?.scrollIntoView?.();
    }
  }, [location.hash]);

  function toggleWeather() {
    const next = !showWeather;
    setShowWeather(next);
    try {
      if (next) localStorage.setItem(WEATHER_KEY, '1');
      else localStorage.removeItem(WEATHER_KEY);
    } catch { /* storage blocked */ }
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-4 py-4">
      <h1 className="mg-h1 mg-h1-sm">Settings</h1>

      <section role="group" aria-label="Colour theme" className="mg-card flex flex-col gap-1 p-3">
        <h2 className="px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">Colour theme</h2>
        {THEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={theme === item.id}
            onClick={() => setTheme(item.id)}
            className={itemClass(theme === item.id)}
          >
            <span className="h-5 w-5 shrink-0 rounded-md border border-[rgb(var(--mg-control))]" style={{ background: item.swatch }} />
            <span className="flex-1">{item.label}</span>
          </button>
        ))}
      </section>

      <section id="lite-mode" className="mg-card scroll-mt-20 p-4">
        <LiteModeSetting />
      </section>

      <section aria-label="Options" className="mg-card flex flex-col gap-1 p-3">
        <h2 className="px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">Options</h2>
        <SettingSwitch icon={CloudSun} label="Show weather" checked={showWeather} onChange={toggleWeather} />
        {current && (
          <SettingSwitch
            icon={Pin}
            label="Remember this competition on this device"
            checked={rememberChoice === 'remember'}
            onChange={() => setRememberChoice(rememberChoice === 'remember' ? 'visit' : 'remember')}
          />
        )}
        {current && (
          <button type="button" onClick={() => { forget(); navigate('/events'); }} className={itemClass(false)}>
            <PinOff aria-hidden="true" className={iconClass(false)} />
            <span className="flex-1">Forget this competition</span>
          </button>
        )}
      </section>

      <section className="mg-card p-3">
        <Link to="/privacy" className={itemClass(false)}>
          <ShieldCheck aria-hidden="true" className={iconClass(false)} />
          <span className="flex-1">Privacy</span>
          <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />
        </Link>
      </section>
    </div>
  );
}

function SettingSwitch({ icon: Icon, label, checked, onChange }: { icon: LucideIcon; label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange} className={itemClass(false)}>
      <Icon aria-hidden="true" className={iconClass(false)} />
      <span className="flex-1">{label}</span>
      <span aria-hidden="true" className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}>
        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}
