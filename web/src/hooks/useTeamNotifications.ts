import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CompetitionDetail, Session, Team } from '../types';
import { SessionKind } from '../types';
import { computeTimings } from '../lib/time';

const ENABLED_KEY = 'mg.notify.enabled';
const FIRED_PREFIX = 'mg.notify.fired:';

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
 * Foreground-only browser notifications for trainers and supporters:
 *   - 1 hour before each of your team's sessions
 *   - 30 minutes before any briefing in the comp
 *   - When the live schedule has slipped 15+ minutes (then again at 25, 35, …)
 *
 * Without a service worker these only fire while the page is open. Tab closed
 * = no notifications. Add VAPID + service worker later for background push.
 */
export function useTeamNotifications(teams: Team[]) {
  const [enabled, setEnabledState] = useState<boolean>(() => readEnabled());
  const [permission, setPermission] = useState<NotificationPermissionState>(permState());
  const [comps, setComps] = useState<Map<number, CompetitionDetail>>(new Map());

  useEffect(() => writeEnabled(enabled), [enabled]);
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
    return () => { cancelled = true; clearInterval(i); };
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
          maybeFire(team, sess, comp.name, timings.get(sess.id), now);
        }
      }
    }
    tick();
    tickRef.current = window.setInterval(tick, 30_000) as unknown as number;
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, [enabled, permission, teams, comps]);

  async function setEnabled(v: boolean) {
    if (v && permission !== 'granted') {
      if (permission === 'unsupported') {
        alert('Browser notifications are not supported here. Try a different browser.');
        return;
      }
      const res = await Notification.requestPermission();
      setPermission(res as NotificationPermissionState);
      if (res !== 'granted') return;
    }
    setEnabledState(v);
  }

  return { enabled, setEnabled, permission };
}

function maybeFire(
  team: Team,
  sess: Session,
  compName: string,
  timing: { scheduled: Date | null; effective: Date | null; shifted: boolean } | undefined,
  now: number,
): void {
  // Only race-format and briefing sessions matter. Breaks/custom skip.
  const kind = (sess.kind ?? (sess.isBreak ? SessionKind.Break : SessionKind.Race));
  if (sess.status === 2) return; // already finished
  if (kind !== SessionKind.Race && kind !== SessionKind.Briefing) return;

  const scheduled = timing?.scheduled?.getTime() ?? null;
  if (scheduled == null) return;

  const minsAhead = (scheduled - now) / 60_000;

  // 1-hour-before-session — fire once in the [60, 55] minute window.
  if (kind === SessionKind.Race && minsAhead <= 60 && minsAhead > 55) {
    fireOnce(
      `1h:${sess.id}`,
      `${team.displayName} — 1 hour to go`,
      `${sess.name} starts at ${fmt(timing!.scheduled!)} (${compName}).`,
    );
  }

  // 30-minutes-before-briefing — fire once in the [30, 25] minute window.
  if (kind === SessionKind.Briefing && minsAhead <= 30 && minsAhead > 25) {
    fireOnce(
      `briefing:${sess.id}`,
      `Briefing in 30 minutes`,
      `${sess.name} — ${compName}`,
    );
  }

  // Schedule shifted — fire at every 10-minute slip bucket starting at 15 min.
  if (timing?.shifted && timing.effective && timing.scheduled && sess.status !== 2) {
    const slipMs = timing.effective.getTime() - timing.scheduled.getTime();
    const absSlip = Math.abs(slipMs) / 60_000;
    if (absSlip >= 15) {
      const bucket = Math.floor((absSlip - 15) / 10) * 10 + 15; // 15, 25, 35…
      const dir = slipMs >= 0 ? 'behind' : 'ahead';
      fireOnce(
        `shift:${sess.id}:${bucket}`,
        `${compName} running ${dir}`,
        `${sess.name} now expected at ${fmt(timing.effective)} (${bucket}+ min ${dir}).`,
      );
    }
  }
}

function fmt(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
