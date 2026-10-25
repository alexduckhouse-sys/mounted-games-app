import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  CloudSun,
  LayoutGrid,
  Pin,
  PinOff,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Type,
  Vibrate,
  type LucideIcon,
} from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import {
  ALL_BOTTOM_TAB_OPTIONS,
  BOTTOM_BAR_PRESETS,
  DEFAULT_BOTTOM_TABS,
  MAX_BOTTOM_TABS,
  MIN_BOTTOM_TABS,
  useUserPrefs,
  type BottomTabId,
  type NotifyLeadMins,
  type TextSizePref,
} from '../lib/userPrefs';
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

  const {
    bottomTabs,
    activePreset,
    notifyLeadMins,
    textSize,
    scorerHaptics,
    setBottomTabs,
    resetBottomTabs,
    applyBottomBarPreset,
    setNotifyMinutesBefore,
    setTextSize,
    setScorerHaptics,
  } = useUserPrefs();

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

  function toggleTab(tabId: BottomTabId) {
    const exists = bottomTabs.includes(tabId);
    if (exists) {
      if (bottomTabs.length <= MIN_BOTTOM_TABS) return;
      setBottomTabs(bottomTabs.filter((id) => id !== tabId));
    } else {
      if (bottomTabs.length >= MAX_BOTTOM_TABS) return;
      setBottomTabs([...bottomTabs, tabId]);
    }
  }

  function moveTab(tabId: BottomTabId, direction: -1 | 1) {
    const idx = bottomTabs.indexOf(tabId);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= bottomTabs.length) return;
    const next = [...bottomTabs];
    const [removed] = next.splice(idx, 1);
    next.splice(targetIdx, 0, removed);
    setBottomTabs(next);
  }

  const isDefaultTabs =
    bottomTabs.length === DEFAULT_BOTTOM_TABS.length &&
    bottomTabs.every((id, idx) => id === DEFAULT_BOTTOM_TABS[idx]);

  const orderedOptions = [
    ...bottomTabs
      .map((id) => ALL_BOTTOM_TAB_OPTIONS.find((opt) => opt.id === id))
      .filter((opt): opt is NonNullable<typeof opt> => Boolean(opt)),
    ...ALL_BOTTOM_TAB_OPTIONS.filter((opt) => !bottomTabs.includes(opt.id)),
  ];

  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-4 py-4">
      <h1 className="sr-only">Settings</h1>

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

      <section aria-labelledby="settings-bottom-bar-heading" className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
            <div>
              <h2 id="settings-bottom-bar-heading" className="text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
                Bottom bar shortcuts
              </h2>
              <p className="mt-0.5 text-xs text-[rgb(var(--mg-muted))]">
                Pick a role preset or choose {MIN_BOTTOM_TABS} to {MAX_BOTTOM_TABS} tabs for competition day ({bottomTabs.length} of {MAX_BOTTOM_TABS} selected).
              </p>
            </div>
          </div>
          {!isDefaultTabs && (
            <button
              type="button"
              onClick={resetBottomTabs}
              className="mg-small-btn !min-h-8 shrink-0 gap-1 px-2.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset to default
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--mg-muted))]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Role presets
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Bottom bar role presets">
            {BOTTOM_BAR_PRESETS.map((preset) => {
              const active = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => applyBottomBarPreset(preset.id)}
                  title={preset.description}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-[rgb(var(--mg-button))] bg-[rgb(var(--mg-button))] text-white'
                      : 'border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <ul className="divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden rounded-[10px] border border-[rgb(var(--mg-line))] bg-[rgb(var(--mg-surface))]">
          {orderedOptions.map((opt) => {
            const selectedIdx = bottomTabs.indexOf(opt.id);
            const selected = selectedIdx !== -1;
            const disableUncheck = selected && bottomTabs.length <= MIN_BOTTOM_TABS;
            const disableCheck = !selected && bottomTabs.length >= MAX_BOTTOM_TABS;
            const disabled = disableUncheck || disableCheck;

            return (
              <li key={opt.id} className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <label className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => toggleTab(opt.id)}
                    className="h-4 w-4 rounded accent-[rgb(var(--mg-button))] disabled:opacity-40"
                  />
                  <span className="truncate font-medium text-[rgb(var(--mg-ink))]">{opt.label}</span>
                  {opt.organiserOnly && (
                    <span className="rounded-full bg-[rgb(var(--mg-subtle))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--mg-muted))]">
                      Organisers
                    </span>
                  )}
                </label>

                {selected && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 text-xs tabular-nums text-[rgb(var(--mg-muted))]">
                      #{selectedIdx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveTab(opt.id, -1)}
                      disabled={selectedIdx === 0}
                      aria-label={`Move ${opt.label} earlier`}
                      className="rounded-lg border border-[rgb(var(--mg-control))] p-1.5 text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTab(opt.id, 1)}
                      disabled={selectedIdx === bottomTabs.length - 1}
                      aria-label={`Move ${opt.label} later`}
                      className="rounded-lg border border-[rgb(var(--mg-control))] p-1.5 text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section id="lite-mode" className="mg-card scroll-mt-20 p-4">
        <LiteModeSetting />
      </section>

      <section aria-label="Options" className="mg-card flex flex-col gap-1 p-3">
        <h2 className="px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">Options</h2>
        <SettingSwitch icon={CloudSun} label="Show weather" checked={showWeather} onChange={toggleWeather} />
        <SettingSwitch icon={Vibrate} label="Scorer tap vibration" checked={scorerHaptics} onChange={() => setScorerHaptics(!scorerHaptics)} />
        <div className="flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-base font-medium text-[rgb(var(--mg-ink))]">
          <Type aria-hidden="true" className={iconClass(false)} />
          <span className="flex-1">Text size</span>
          <div role="group" aria-label="Text size" className="mg-toggle">
            {(['normal', 'large'] as const).map((size: TextSizePref) => (
              <button
                key={size}
                type="button"
                aria-pressed={textSize === size}
                onClick={() => setTextSize(size)}
              >
                {size === 'normal' ? 'Normal' : 'Large'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-base font-medium text-[rgb(var(--mg-ink))]">
          <Clock aria-hidden="true" className={iconClass(false)} />
          <span className="flex-1">Heat reminder timing</span>
          <div role="group" aria-label="Heat reminder timing" className="mg-toggle">
            {([15, 30, 60] as const).map((mins: NotifyLeadMins) => (
              <button
                key={mins}
                type="button"
                aria-pressed={notifyLeadMins === mins}
                onClick={() => setNotifyMinutesBefore(mins)}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>
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
