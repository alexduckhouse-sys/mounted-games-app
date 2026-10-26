import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Minus, Plus } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { CardDropdownRow } from '../components/CardDropdownRow';
import { usePageHeader } from '../components/CompactPageBarContext';
import { ALL_BOTTOM_TAB_OPTIONS, DEFAULT_BOTTOM_TABS, useUserPrefs, type BottomTabId, type TextSizePref } from '../lib/userPrefs';
import { dropIndex, makeRoom, moveItem } from '../lib/creatorRaces';
import { itemsFromTabs, REMINDER_MAX, REMINDER_MIN, stepReminder, tabCountFlag, tabsFromItems, type TabItem } from '../lib/settingsEdit';
import { LiteModeSetting } from '../lite/LiteModeSetting';
import { THEMES, type ThemeName } from '../theme/themes';
import { useTheme } from '../theme/ThemeContext';
import { RefineSwitchRow } from './refine/Refine';
import '../components/sitePages.css';

const WEATHER_KEY = 'mg.showWeather';

const TEXT_SIZES: { value: TextSizePref; label: string }[] = [{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }];

/** The policy pages, each at its own address. */
const POLICIES = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms of service' },
  { to: '/refunds', label: 'Refunds and payments' },
  { to: '/cookies', label: 'Cookies and storage' },
  { to: '/safeguarding', label: 'Safeguarding and welfare' },
] as const;

/** Six dots: the grip for dragging a tab. */
function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
    </svg>
  );
}

interface Drag { id: BottomTabId; from: number; to: number; dy: number; height: number }

export function SettingsPage() {
  usePageHeader({ title: 'Settings', plain: true });
  const { current, rememberChoice, setRememberChoice, forget } = useCurrentCompetition();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [showWeather, setShowWeather] = useState(() => {
    try { return localStorage.getItem(WEATHER_KEY) === '1'; } catch { return false; }
  });

  const { bottomTabs, notifyLeadMins, textSize, scorerHaptics, sortByLaneOrder, setBottomTabs, resetBottomTabs, setNotifyMinutesBefore, setTextSize, setScorerHaptics, setSortByLaneOrder } = useUserPrefs();
  // The list keeps what was chosen even when it won't fit the bar (flagged, not blocked); what is saved is the part that fits.
  const [items, setItems] = useState<TabItem[]>(() => itemsFromTabs(bottomTabs));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const itemsRef = useRef(items);

  useEffect(() => {
    if (location.hash === '#lite-mode') document.getElementById('lite-mode')?.scrollIntoView?.();
  }, [location.hash]);

  function toggleWeather() {
    const next = !showWeather;
    setShowWeather(next);
    try {
      if (next) localStorage.setItem(WEATHER_KEY, '1');
      else localStorage.removeItem(WEATHER_KEY);
    } catch { /* storage blocked */ }
  }

  function change(next: TabItem[]) {
    itemsRef.current = next;
    setItems(next);
    setBottomTabs(tabsFromItems(next));
  }
  function reset() {
    resetBottomTabs();
    const next = itemsFromTabs(DEFAULT_BOTTOM_TABS);
    itemsRef.current = next;
    setItems(next);
  }
  const toggleTab = (id: BottomTabId) => change(items.map((item) => (item.id === id ? { ...item, on: !item.on } : item)));
  const moveBy = (index: number, by: -1 | 1) => { if (index + by >= 0 && index + by < items.length) change(moveItem(items, index, index + by)); };

  function grab(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (event.button > 0) return;
    event.preventDefault();
    const row = event.currentTarget.closest('[data-tab-row]');
    const height = row ? row.getBoundingClientRect().height : 52;
    const y0 = event.clientY;
    const start: Drag = { id: items[index].id, from: index, to: index, dy: 0, height };
    dragRef.current = start;
    setDrag(start);
    const move = (e: PointerEvent) => {
      const dy = e.clientY - y0;
      const next = { ...start, dy, to: dropIndex(index, dy, height, itemsRef.current.length) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const done = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (done && done.to !== done.from) change(moveItem(itemsRef.current, done.from, done.to));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function keys(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    moveBy(index, by);
  }

  const onIds = tabsFromItems(items);
  const isDefaultTabs = onIds.length === DEFAULT_BOTTOM_TABS.length && onIds.every((id, index) => id === DEFAULT_BOTTOM_TABS[index]);
  const flag = tabCountFlag(onIds.length);

  return (
    <div className="skin mx-auto w-full max-w-[560px] pb-4 pt-3">
      <h1 className="sr-only">Settings</h1>

      <h2 className="sp-sec sp-first">Look</h2>
      <div className="sp-card">
        <CardDropdownRow label="Colour theme" value={theme} options={THEMES.map((item) => ({ value: item.id, label: item.label }))}
          swatch={(value) => THEMES.find((item) => item.id === value)?.swatch} onChange={(value) => setTheme(value as ThemeName)} />
        <CardDropdownRow label="Text size" value={textSize} options={TEXT_SIZES} onChange={(value) => setTextSize(value as TextSizePref)} />
        <div id="lite-mode" className="scroll-mt-20"><LiteModeSetting /></div>
      </div>

      <h2 className="sp-sec">Bottom bar <small>2 to 6 tabs{!isDefaultTabs && <> · <button type="button" className="font-semibold text-[rgb(var(--mg-heading))] underline" onClick={reset}>Reset to default</button></>}</small></h2>
      <ul className="sp-card m-0 list-none p-0" aria-label="Bottom bar tabs">
        {items.map((item, index) => {
          const option = ALL_BOTTOM_TAB_OPTIONS.find((candidate) => candidate.id === item.id)!;
          const lifted = drag?.id === item.id;
          const shift = drag && !lifted ? makeRoom(index, drag.from, drag.to, drag.height) : 0;
          return (
            <li key={item.id} data-tab-row="" data-off={!item.on || undefined} data-dragging={lifted || undefined} className="sp-row sp-tab-row"
              style={lifted && drag ? { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 2 } : shift ? { transform: `translateY(${shift}px)` } : undefined}>
              <button type="button" className="sp-grip" aria-label={`Move ${option.label}: drag, or use the up and down arrow keys`}
                onPointerDown={(event) => grab(event, index)} onKeyDown={(event) => keys(event, index)}><GripIcon /></button>
              <span className="sp-t1 sp-grow">{option.label}</span>
              {option.organiserOnly && <span className="sp-t2">Organisers</span>}
              <button type="button" role="switch" aria-checked={item.on} aria-label={`Show ${option.label} in the bottom bar`} className="rf-sw" onClick={() => toggleTab(item.id)}><span aria-hidden="true" /></button>
            </li>
          );
        })}
      </ul>
      {flag && <p role="status" className="sp-note sp-warn">{flag}</p>}

      <h2 className="sp-sec">On competition days</h2>
      <div className="sp-card">
        <RefineSwitchRow label="Show weather" on={showWeather} onChange={toggleWeather} />
        <RefineSwitchRow label="Vibrate when I tap a score" on={scorerHaptics} onChange={setScorerHaptics} />
        <RefineSwitchRow label="Order scoring teams by lane" on={sortByLaneOrder} onChange={setSortByLaneOrder} />
        {current && <RefineSwitchRow label="Remember the competition I open" on={rememberChoice === 'remember'} onChange={(on) => setRememberChoice(on ? 'remember' : 'visit')} />}
        <div className="sp-row">
          <span className="sp-grow"><span className="sp-t1">Remind me before a heat</span><span className="sp-t2">While the app is open</span></span>
          <span className="sp-stepper" role="group" aria-label="Heat reminder">
            <button type="button" aria-label="5 minutes less" disabled={notifyLeadMins <= REMINDER_MIN} onClick={() => setNotifyMinutesBefore(stepReminder(notifyLeadMins, -1))}><Minus className="h-[18px] w-[18px]" aria-hidden="true" /></button>
            <output aria-live="polite">{notifyLeadMins} min</output>
            <button type="button" aria-label="5 minutes more" disabled={notifyLeadMins >= REMINDER_MAX} onClick={() => setNotifyMinutesBefore(stepReminder(notifyLeadMins, 1))}><Plus className="h-[18px] w-[18px]" aria-hidden="true" /></button>
          </span>
        </div>
        {current && <button type="button" className="sp-row" onClick={() => { forget(); navigate('/events'); }}><span className="sp-t1 sp-grow">Forget this competition</span></button>}
      </div>

      <h2 className="sp-sec">Policies</h2>
      <ul className="sp-card m-0 list-none p-0" aria-label="Policies and legal">
        {POLICIES.map((policy) => (
          <li key={policy.to}><Link to={policy.to} className="sp-row"><span className="sp-t1 sp-grow !font-medium">{policy.label}</span><ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} /></Link></li>
        ))}
      </ul>
    </div>
  );
}
