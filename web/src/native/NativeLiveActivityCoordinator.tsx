/* eslint-disable react-refresh/only-export-components -- app-lifetime coordinator shares its serial queue with the opt-in control. */
import { useEffect } from 'react';
import { api } from '../api';
import { FAVOURITES_CHANGED, readFavourites } from '../lib/favourites';
import { endTeamActivity, listTeamActivities, needsRestart, startTeamActivity, updateTeamActivity, type TeamProgressSnapshot } from './liveActivity';
import { isIosApp } from './platform';

export const ACTIVITY_CHANGED = 'mg:activity-choice';
const KEY = 'mg.activity-choice.v1';
export interface ActivityChoice { competitionId: number; teamId: number; teamName: string; activityId: string }
export function activityChoice(): ActivityChoice | null {
  try { const x: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!x || typeof x !== 'object') return null;
    const v = x as ActivityChoice;
    return Number.isInteger(v.competitionId) && Number.isInteger(v.teamId) && typeof v.teamName === 'string' && typeof v.activityId === 'string' ? v : null;
  } catch { return null; }
}
function save(choice: ActivityChoice | null) {
  if (choice) localStorage.setItem(KEY, JSON.stringify(choice)); else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(ACTIVITY_CHANGED));
}
let queue: Promise<void> = Promise.resolve();
function serial(work: () => Promise<void>): Promise<void> {
  const next = queue.catch(() => undefined).then(work); queue = next; return next;
}
export function chooseTeamActivity(competitionId: number, teamId: number, teamName: string): Promise<void> {
  return serial(async () => {
    const current = activityChoice();
    const activities = await listTeamActivities();
    for (const item of activities) await endTeamActivity(item.activityId);
    save(null);
    if (current?.competitionId === competitionId && current.teamId === teamId) return;
    const snapshot = (await api.get<TeamProgressSnapshot>(`/competitions/${competitionId}/teams/${teamId}/progress`)).data;
    const activityId = await startTeamActivity(snapshot, teamName);
    if (activityId) {
      try { save({ competitionId, teamId, teamName, activityId }); }
      catch (error) { await endTeamActivity(activityId); throw error; }
    }
  });
}
export function refreshNativeActivity(): Promise<void> {
  if (!isIosApp() || document.visibilityState === 'hidden') return Promise.resolve();
  return serial(async () => {
    const choice = activityChoice(); if (!choice) return;
    const activities = await listTeamActivities();
    const current = activities.find(x => x.activityId === choice.activityId);
    // Missing means dismissed, disabled or expired. Never silently recreate a dismissed card.
    if (!current) { save(null); return; }
    if (!readFavourites().some(x => x.competitionId === choice.competitionId && x.teamId === choice.teamId)) {
      await endTeamActivity(current.activityId); save(null); return;
    }
    const snapshot = (await api.get<TeamProgressSnapshot>(`/competitions/${choice.competitionId}/teams/${choice.teamId}/progress`)).data;
    if (needsRestart(current)) {
      await endTeamActivity(current.activityId);
      const activityId = await startTeamActivity(snapshot, choice.teamName);
      save(activityId ? { ...choice, activityId } : null);
    } else await updateTeamActivity(current.activityId, snapshot);
  });
}
/** Mounted once below app providers. Native token delivery continues independently when this WebView sleeps. */
export function NativeLiveActivityCoordinator() {
  useEffect(() => {
    if (!isIosApp()) return;
    const refresh = () => { void refreshNativeActivity().catch(() => { /* Existing stale date remains honest on failed refresh. */ }); };
    refresh(); const timer = window.setInterval(refresh, 30_000);
    for (const event of [FAVOURITES_CHANGED, 'mg:live-progress', 'online', 'focus']) window.addEventListener(event, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); for (const event of [FAVOURITES_CHANGED, 'mg:live-progress', 'online', 'focus']) window.removeEventListener(event, refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return null;
}
