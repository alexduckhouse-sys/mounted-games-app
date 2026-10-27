import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, readStoredAuth, writeStoredAuth, type StoredAuth } from '../api';
import type { CompetitionAccess, ExternalAuthResponse, Role, UserProfile } from '../types';

export type ExternalAuthResult =
  | { needsSignup: false }
  | { needsSignup: true; email: string; suggestedName: string; provider: string };

export interface ExternalAuthOptions {
  nonce?: string;
  fullName?: string;
  clubName?: string;
  role?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  trainerNotice: 'requested' | 'approved' | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithAdminKey: (key: string, title?: string, email?: string, password?: string) => Promise<void>;
  loginWithExternal: (provider: string, idToken: string, options?: ExternalAuthOptions) => Promise<ExternalAuthResult>;
  /** `username` is the email; `fullName` is the person's own name (without it the API uses the start of the email). */
  signupTrainer: (username: string, password: string, role?: string, clubName?: string, fullName?: string) => Promise<void>;
  /** Turns an emailed invitation into an account (`POST /auth/invites/accept`) and signs the person in. */
  acceptInvite: (token: string, fullName: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-reads the signed-in person's profile, e.g. after they confirm their email address. */
  refreshUser: () => Promise<void>;
  /** True from a deliberate sign-out until the next sign-in, so protected pages can send the person somewhere public rather than to the sign-in page. */
  signedOut: boolean;
  hasRole: (role: Role) => boolean;
  /** True for site admins. There is no separate edit mode: the server decides, this only shows or hides controls. */
  canEdit: () => boolean;
  /**
   * Approved trainers can act as organisers — they can create + edit
   * competitions they own. This returns true for Admins (always) and for
   * Trainers who own the competition.
   * Use for organiser-only surfaces like the comp creator wizard's Save.
   */
  canOrganise: (competition?: CompetitionRef) => boolean;
  /**
   * Whether to show the controls that run one competition's day (scoring,
   * sessions, finals, timetable): anyone who can organise that competition.
   */
  canManage: (competition?: CompetitionRef) => boolean;
  /** Reload the competitions this user owns or helps on, e.g. after leaving a team. */
  refreshAccess: () => Promise<void>;
}

/** The parts of a competition that decide who may organise it. */
type CompetitionRef = { id?: number; createdByUserId?: string | null };

const NO_ACCESS: CompetitionAccess[] = [];

/** The signed-in user's list, or null when it can't be had: a dropped connection must not take access away. */
async function fetchAccess(): Promise<CompetitionAccess[] | null> {
  try {
    const { data } = await api.get<unknown>('/competitions/access');
    return parseAccess(data);
  } catch {
    return null;
  }
}

/** Keeps only well-formed entries, so a wrong response can never grant access. */
function parseAccess(data: unknown): CompetitionAccess[] | null {
  if (!Array.isArray(data)) return null;
  return data.filter((item): item is CompetitionAccess => !!item
    && typeof item.competitionId === 'number'
    && typeof item.owner === 'boolean');
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Admin edit mode was removed; clear the old saved switch once.
const OLD_EDITOR_MODE_KEY = 'mg.adminEditorMode';

export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    try { localStorage.removeItem(OLD_EDITOR_MODE_KEY); } catch { /* storage blocked */ }
  }, []);
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth());
  const [loading, setLoading] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [notice, setNotice] = useState<{ token: string; kind: 'requested' | 'approved' } | null>(null);
  const token = auth?.token ?? null;
  const pendingApproval = auth?.user.roles.some((role) => role === 'TrainerRequest' || role === 'ManagerRequest') ?? false;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get<UserProfile>('/auth/me').then(({ data }) => {
      if (!cancelled && pendingApproval && (data.roles.includes('Trainer') || data.roles.includes('Manager'))) {
        // Keep the saved roles aligned with the JWT until the next sign-in.
        setNotice({ token, kind: 'approved' });
      }
    }).catch((error: { response?: { status?: number } }) => {
      // A dropped connection does not mean the saved login is invalid.
      if (!cancelled && error.response?.status === 401) {
        setAuth(null);
        writeStoredAuth(null);
      }
    });
    return () => { cancelled = true; };
  }, [token, pendingApproval]);

  const userKey = auth?.user.id ?? null;
  // Remember whose list this is, so one person's access is never shown to the next.
  const [accessState, setAccessState] = useState<{ userKey: string; items: CompetitionAccess[] } | null>(null);
  const access = accessState && accessState.userKey === userKey ? accessState.items : NO_ACCESS;
  useEffect(() => {
    if (!token || !userKey) return;
    let current = true;
    fetchAccess().then((items) => { if (current && items) setAccessState({ userKey, items }); });
    return () => { current = false; };
  }, [token, userKey]);
  const refreshAccess = useCallback(async () => {
    if (!token || !userKey) return;
    const items = await fetchAccess();
    if (items) setAccessState({ userKey, items });
  }, [token, userKey]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/login', { email, password });
      writeStoredAuth(data);
      setAuth(data);
      setSignedOut(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithAdminKey = useCallback(async (key: string, title?: string, email?: string, password?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/admin-key', {
        key,
        ...(title ? { title } : {}),
        ...(email ? { email } : {}),
        ...(password ? { password } : {}),
      });
      writeStoredAuth(data);
      setAuth(data);
      setSignedOut(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithExternal = useCallback(async (
    provider: string,
    idToken: string,
    options?: ExternalAuthOptions,
  ): Promise<ExternalAuthResult> => {
    setLoading(true);
    try {
      const { data } = await api.post<ExternalAuthResponse>('/auth/external', {
        provider,
        idToken,
        ...(options?.nonce ? { nonce: options.nonce } : {}),
        ...(options?.fullName ? { fullName: options.fullName } : {}),
        ...(options?.clubName ? { clubName: options.clubName } : {}),
        ...(options?.role ? { role: options.role } : {}),
      });
      if (!data.needsSignup && data.auth) {
        writeStoredAuth(data.auth);
        setAuth(data.auth);
        setSignedOut(false);
        setNotice(
          data.auth.user.roles.some((role) => role === 'TrainerRequest' || role === 'ManagerRequest')
            ? { token: data.auth.token, kind: 'requested' }
            : null,
        );
        return { needsSignup: false };
      }
      return {
        needsSignup: true,
        email: data.email ?? '',
        suggestedName: data.suggestedName ?? '',
        provider: data.provider ?? provider,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const signupTrainer = useCallback(async (username: string, password: string, role?: string, clubName?: string, fullName?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/signup-trainer', {
        username, password, role, clubName, fullName,
      });
      writeStoredAuth(data);
      setAuth(data);
      setSignedOut(false);
      setNotice(data.user.roles.some((role) => role === 'TrainerRequest' || role === 'ManagerRequest') ? { token: data.token, kind: 'requested' } : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const acceptInvite = useCallback(async (inviteToken: string, fullName: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/invites/accept', { token: inviteToken, fullName, password });
      writeStoredAuth(data);
      setAuth(data);
      setSignedOut(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get<UserProfile>('/auth/me');
      setAuth((cur) => {
        if (!cur || cur.user.id !== data.id) return cur;
        const next = { ...cur, user: { ...cur.user, ...data } };
        writeStoredAuth(next);
        return next;
      });
    } catch {
      // A dropped connection leaves what we already know.
    }
  }, []);

  const logout = useCallback(() => {
    writeStoredAuth(null);
    setAuth(null);
    setSignedOut(true);
  }, []);

  const user: UserProfile | null = useMemo(() => {
    if (!auth) return null;
    return {
      id: auth.user.id,
      email: auth.user.email,
      fullName: auth.user.fullName,
      clubId: auth.user.clubId,
      clubName: auth.user.clubName,
      roles: auth.user.roles as Role[],
      emailConfirmed: auth.user.emailConfirmed,
    };
  }, [auth]);

  const hasRole = useCallback((role: Role) => !!user?.roles.includes(role), [user]);

  const canEdit = useCallback(() => hasRole('Admin'), [hasRole]);
  // Ownership is also enforced by the API; this hides controls the viewer cannot use.
  const canOrganise = useCallback(
    (competition?: CompetitionRef) => hasRole('Admin')
      || (hasRole('Trainer') && (!competition || competition.createdByUserId === user?.id))
      || (!!user && competition?.id != null && access.some((entry) => entry.competitionId === competition.id)),
    [hasRole, user, access]);
  const canManage = canOrganise;

  const value: AuthContextValue = {
    user,
    token: auth?.token ?? null,
    loading,
    trainerNotice: notice && notice.token === token ? notice.kind : null,
    login,
    loginWithAdminKey,
    loginWithExternal,
    signupTrainer,
    acceptInvite,
    logout,
    refreshUser,
    signedOut,
    hasRole,
    canEdit,
    canOrganise,
    canManage,
    refreshAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The provider and hook share one context; this module also exports that hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
