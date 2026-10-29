import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n/LanguageContext';
import { Notice } from '../components/Notice';
import { liveActivitiesEnabled } from './liveActivity';
import { isIosApp } from './platform';
import { ACTIVITY_CHANGED, activityChoice, chooseTeamActivity } from './NativeLiveActivityCoordinator';

export function LiveActivityChoice({ competitionId, teamId, teamName }: { competitionId: number; teamId: number; teamName: string }) {
  const t = useT(); const [available, setAvailable] = useState(false); const [choice, setChoice] = useState(activityChoice);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => {
    if (!isIosApp()) return;
    let cancelled = false;
    void Promise.all([liveActivitiesEnabled(), api.get<{ liveActivities: boolean }>('/apple/availability')]).then(([enabled, response]) => {
      if (!cancelled) setAvailable(enabled && response.data.liveActivities);
    }).catch(() => undefined);
    const changed = () => setChoice(activityChoice()); window.addEventListener(ACTIVITY_CHANGED, changed);
    return () => { cancelled = true; window.removeEventListener(ACTIVITY_CHANGED, changed); };
  }, []);
  if (!available) return null;
  const on = choice?.competitionId === competitionId && choice.teamId === teamId;
  return <div className="border-t border-[rgb(var(--mg-rule-soft))] px-4 py-2">
    <button type="button" role="switch" aria-checked={on} disabled={busy} className="flex min-h-11 w-full items-center justify-between gap-3 text-sm font-semibold"
      onClick={() => { setBusy(true); setError(false); void chooseTeamActivity(competitionId, teamId, teamName).catch(() => setError(true)).finally(() => setBusy(false)); }}>
      <span>{t('apple.activity.show')}</span><span aria-hidden="true" className={`relative h-6 w-10 rounded-full ${on ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[rgb(var(--mg-surface))] ${on ? 'right-0.5' : 'left-0.5'}`} /></span>
    </button>
    {on && <p className="mg-meta">{t('apple.activity.expiry')}</p>}
    {error && <Notice>{t('apple.activity.error')}</Notice>}
  </div>;
}
