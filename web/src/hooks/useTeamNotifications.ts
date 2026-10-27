import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CompetitionDetail, Session, Team } from '../types';
import { SessionKind } from '../types';
import { computeTimings } from '../lib/time';
import { subscribeForPushResult, unsubscribeFromPush, type PushResult } from '../lib/push';
import { hatbandName } from '../lib/hatbands';
import { formatNotifyLeadReminder, getNotifyMinutesBefore } from '../lib/userPrefs';

const ENABLED_KEY = 'mg.notify.enabled';
const FIRED_PREFIX = 'mg.notify.fired:';

/** What the page says when someone turns alerts on in a browser that can't show them (on iPhone, Safari only can once the app is on the Home Screen). */
export const NOT_SUPPORTED = 'This browser can’t show notifications. On iPhone, add Mounted Games to your Home Screen and open it from there.';
export const DENIED = 'Notifications are blocked for this site. Allow them in your browser settings, then switch them on again.';
export const BROWSER_REFUSED = 'Your browser wouldn’t set up notifications. Try again in a moment.';
export const SERVER_REFUSED = 'We couldn’t register this phone for notifications. Check your signal and try again.';

/** The plain sentence for a failed switch-on, or null when it worked. */
export function pushProblem(result: PushResult): string | null {
  switch (result) {
    case 'ok': return null;
    case 'unsupported': return NOT_SUPPORTED;
    case 'denied': return DENIED;
    case 'browser': return BROWSER_REFUSED;
    case 'server': return SERVER_REFUSED;
  }
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function permState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

function readEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}
function writeEnabled(v: boolean): void {
  try {
    if (v) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* quota */ }
}

function fireOnce(key: string, title: string, body: string): void {
  try {
    if (localStorage.getItem(FIRED_PREFIX + key)) return;
    localStorage.setItem(FIRED_PREFIX + key, '1');
  } catch { /* quota — fall through and still show */ }
  try {
    new Notification(title, { body, tag: key });
  } catch { /* perm changed mid-tick */ }
}

/**
 * Foreground-only browser notifications for trainers and supporters (the server separately sends background
 * pushes a fixed 60 minutes before each heat, and 30 minutes before a briefing):
 *   - the chosen lead time before each of your team's sessions
 *   - 30 minutes before any briefing in the comp
 *   - When the live schedule has slipped 15+ minutes (then again at 25, 35, …)
 *
 * Without a service worker these only fire while the page is open. Tab closed
 * = no notifications. Add VAPID + service worker later for background push.
 */
export function useTeamNotifications(teams: Team[]) {
  // On means the browser allows it. Whether the server accepted this phone is checked below.
  const [enabled, setEnabledState] = useState<boolean>(() => readEnabled() && permState() === 'granted');
  const [permission, setPermission] = useState<NotificationPermissionState>(permState());
  const [problem, setProblem] = useState<string | null>(null);
  const [comps, setComps] = useState<Map<number, CompetitionDetail>>(new Map());

  useEffect(() => writeEnabled(enabled), [enabled]);

  // A saved "on" is only true if this phone is still registered. Check once on load, and show it as off if not.
  const startedOn = useRef(enabled);
  useEffect(() => {
    if (!startedOn.current || !navigator.onLine) return;
    let cancelled = false;
    void subscribeForPushResult().then((result) => {
      if (cancelled || result === 'ok') return;
      setProblem(pushProblem(result));
      setEnabledState(false);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const onFocus = () => setPermission(permState());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Load the full detail for every comp the user has a team in. Cheap enough
  // for the foreground case (one fetch per comp, refreshed every 60s).
  useEffect(() => {
    if (!enabled || teams.length === 0) return;
    const compIds = Array.from(new Set(teams.map((t) => t.competitionId)));
    let cancelled = false;
    function pull() {
      // A locked phone or no signal: skip, and catch up when the page is back.
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      Promise.all(compIds.map((id) =>
        api.get<CompetitionDetail>(`/competitions/${id}`).then((r) => [id, r.data] as const).catch(() => null)
      )).then((rows) => {
        if (cancelled) return;
        const next = new Map<number, CompetitionDetail>();
        for (const r of rows) if (r) next.set(r[0], r[1]);
        setComps(next);
      });
    }
    pull();
    const i = setInterval(pull, 60_000);
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('online', pull);
    return () => {
      cancelled = true;
      clearInterval(i);
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', pull);
    };
  }, [enabled, teams]);

  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || permission !== 'granted') return;
    function tick() {
      const now = Date.now();
      for (const team of teams) {
        const comp = comps.get(team.competitionId);
        if (!comp) continue;
        const timings = computeTimings(comp.sessions);
        for (const sess of comp.sessions) {
          maybeFire(team, sess, comp.name, comp.laneHatbands, timings.get(sess.id), now);
        }
      }
    }
    tick();
    tickRef.current = window.setInterval(tick, 30_000) as unknown as number;
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, [enabled, permission, teams, comps]);

  async function setEnabled(v: boolean) {
    if (!v) {
      setProblem(null);
      setEnabledState(false);
      await unsubscribeFromPush();
      return;
    }
    if (permission === 'unsupported') {
      setProblem(NOT_SUPPORTED);
      return;
    }
    if (permission !== 'granted') {
      const res = await Notification.requestPermission();
      setPermission(res as NotificationPermissionState);
      if (res !== 'granted') {
        if (res === 'denied') setProblem(DENIED);
        return;
      }
    }
    // Only show it as on once this phone is registered for background alerts.
    const result = await subscribeForPushResult();
    const problem = pushProblem(result);
    setProblem(problem);
    if (result === 'denied' || result === 'unsupported') setPermission(permState());
    setEnabledState(problem === null);
  }

  return { enabled, setEnabled, permission, problem };
}

function maybeFire(
  team: Team,
  sess: Session,
  compName: string,
  laneHatbands: string[] | null | undefined,
  timing: { scheduled: Date | null; effective: Date | null; shifted: boolean } | undefined,
  now: number,
): void {
  // Only race-format and briefing sessions matter. Breaks/custom skip.
  const kind = (sess.kind ?? (sess.isBreak ? SessionKind.Break : SessionKind.Race));
  if (sess.status === 2) return; // already finished
  if (kind !== SessionKind.Race && kind !== SessionKind.Briefing) return;

  // Prefix the title so supporters see "Supporting X" rather than implying
  // they are the trainer.
  const teamLabel = team.relationship === 'supporter'
    ? `Supporting ${team.displayName}`
    : team.displayName;

  // Finals lane + time + hatband/silk notification as soon as a team is drawn into a Final heat.
  const isFinalSession = /\bfinal/i.test(sess.name);
  if (kind === SessionKind.Race) {
    for (const heat of sess.heats ?? []) {
      const isFinalHeat = isFinalSession || /\bfinal/i.test(heat.label ?? '') || heat.raceRoundStage === 2;
      if (!isFinalHeat) continue;
      const entry = heat.entries?.find((e) => e.teamId === team.id);
      if (!entry) continue;
      const hatband = hatbandName(laneHatbands?.[entry.laneIndex - 1]);
      const laneDetail = hatband
        ? `Lane ${entry.laneIndex} (${hatband} hatband/silk)`
        : `Lane ${entry.laneIndex}`;
      const timeWhen = timing?.effective ?? timing?.scheduled;
      const timeDetail = timeWhen ? ` at ${fmt(timeWhen)}` : '';
      const finalLabel = heat.label?.trim() || sess.name;
      fireOnce(
        `final-draw:${heat.id}:${team.id}:${entry.laneIndex}`,
        `${teamLabel} — ${finalLabel}`,
        `${finalLabel}${timeDetail} · ${laneDetail} (${compName}).`,
      );
    }
  }

  const scheduled = timing?.scheduled?.getTime() ?? null;
  if (scheduled == null) return;

  const minsAhead = (scheduled - now) / 60_000;

  // Lead-time-before-session — fire once in the [leadMins, leadMins - 5] minute window.
  const leadMins = getNotifyMinutesBefore();
  if (kind === SessionKind.Race && minsAhead <= leadMins && minsAhead > leadMins - 5) {
    const { tag, title } = formatNotifyLeadReminder(leadMins, sess.id, team.id, teamLabel);
    const teamEntry = sess.heats?.flatMap((h) => h.entries ?? []).find((e) => e.teamId === team.id);
    const hatband = teamEntry ? hatbandName(laneHatbands?.[teamEntry.laneIndex - 1]) : '';
    const laneSuffix = teamEntry
      ? ` · Lane ${teamEntry.laneIndex}${hatband ? ` (${hatband} hatband/silk)` : ''}`
      : '';
    fireOnce(
      tag,
      title,
      `${sess.name} starts at ${fmt(timing!.scheduled!)}${laneSuffix} (${compName}).`,
    );
  }

  // 30-minutes-before-briefing — fire once in the [30, 25] minute window.
  if (kind === SessionKind.Briefing && minsAhead <= 30 && minsAhead > 25) {
    fireOnce(
      `briefing:${sess.id}:${team.id}`,
      `Briefing in 30 minutes`,
      `${sess.name} — ${compName} (${teamLabel})`,
    );
  }

  // Schedule shifted — fire at every 10-minute slip bucket starting at 15 min.
  // (status === 2 / Finished was already filtered at the top of this function.)
  if (timing?.shifted && timing.effective && timing.scheduled) {
    const slipMs = timing.effective.getTime() - timing.scheduled.getTime();
    const absSlip = Math.abs(slipMs) / 60_000;
    if (absSlip >= 15) {
      const bucket = Math.floor((absSlip - 15) / 10) * 10 + 15; // 15, 25, 35…
      const how = slipMs >= 0 ? 'late' : 'early';
      fireOnce(
        `shift:${sess.id}:${bucket}:${team.id}`,
        `${compName} is running ${Math.round(absSlip)} minutes ${how}`,
        `${sess.name} is now about ${fmt(timing.effective)}. ${teamLabel}.`,
      );
    }
  }
}

function fmt(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
