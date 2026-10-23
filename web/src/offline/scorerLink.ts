import axios from 'axios';
import type { ScorerSession } from '../types';

/**
 * A volunteer scorer opens `/score#t=<token>`. The token sits in the URL fragment, which the browser never
 * sends to a server, so it stays out of logs and Referer headers. The page keeps it on the phone and sends it
 * in the X-Scorer-Token header. It is never a sign-in: it can only score one arena.
 */
const TOKEN_KEY = 'mg.scorer.token';
const SESSION_KEY = 'mg.scorer.session';
const SESSION_AT_KEY = 'mg.scorer.sessionAt';

/** The token in a URL fragment such as `#t=mgs_abc`, or null. */
export function tokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('t')?.trim();
  return value ? value : null;
}

/** The address an organiser hands out, and a plain string a QR code can encode. */
export function scorerLinkUrl(origin: string, token: string): string {
  return `${origin}/score#t=${token}`;
}

export function readScorerToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

export function writeScorerToken(token: string): boolean {
  try { localStorage.setItem(TOKEN_KEY, token); return true; } catch { return false; }
}

/** Forget the token and the saved timetable, e.g. when the link has been withdrawn. */
export function clearScorerToken() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_AT_KEY); } catch { /* storage unavailable */ }
}

/** A separate client, so a scorer link never touches a signed-in account's token or clears it on a 401. */
export const scorerApi = axios.create({ baseURL: import.meta.env.VITE_API_BASE ?? '/api' });

scorerApi.interceptors.request.use((config) => {
  const token = readScorerToken();
  if (token) config.headers.set('X-Scorer-Token', token);
  if (config.method?.toLowerCase() === 'get' && !config.timeout) config.timeout = 15_000;
  return config;
});

/** Keeps a wrong or partial response (such as the app's HTML page) from reaching the screen. */
export function parseScorerSession(data: unknown): ScorerSession | null {
  const s = data as Partial<ScorerSession> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.sessions) || typeof s.competitionId !== 'number'
    || typeof s.label !== 'string' || typeof s.arenaName !== 'string') return null;
  return {
    label: s.label,
    competitionId: s.competitionId,
    competitionName: typeof s.competitionName === 'string' ? s.competitionName : '',
    arenaName: s.arenaName,
    expiresAt: typeof s.expiresAt === 'string' ? s.expiresAt : '',
    sessions: s.sessions.filter((x) => !!x && Array.isArray(x.heats)),
  };
}

export function readSavedScorerSession(): ScorerSession | null {
  try { return parseScorerSession(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')); } catch { return null; }
}

export function writeSavedScorerSession(session: ScorerSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(SESSION_AT_KEY, new Date().toISOString());
  } catch { /* storage full: the live copy still works */ }
}

/** When the saved timetable last came from the server, or null if unknown. */
export function readSavedScorerSessionAt(): string | null {
  try { return localStorage.getItem(SESSION_AT_KEY) || null; } catch { return null; }
}

export type ScorerLoadFailure = 'missing' | 'invalid' | 'withdrawn' | 'offline' | 'other';

/** Why loading the timetable failed, in the words the page needs. */
export function scorerFailure(err: unknown): ScorerLoadFailure {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === undefined) return 'offline';
  if (status === 401) return 'missing';
  if (status === 404) return 'invalid';
  if (status === 410) return 'withdrawn';
  if (status >= 500 || status === 408 || status === 429) return 'offline';
  return 'other';
}
