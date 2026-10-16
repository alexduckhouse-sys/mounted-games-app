import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, readStoredAuth, writeStoredAuth, type StoredAuth } from '../api';
import type { Role, UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  trainerNotice: 'requested' | 'approved' | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithAdminKey: (key: string) => Promise<void>;
  signupTrainer: (username: string, password: string, role?: string, clubName?: string) => Promise<void>;
  logout: () => void;
  hasRole: (role: Role) => boolean;
  /**
   * Admin "Edit mode" — when off, admin gets the public-view UI without write
   * affordances (no Delete buttons, no Save/Score submit, no status toggles).
   * Use `canEdit()` to gate destructive controls. Non-admin users always
   * have this off; flipping it requires `Admin` role.
   */
  editorMode: boolean;
  setEditorMode: (v: boolean) => void;
  canEdit: () => boolean;
  /**
   * Approved trainers can act as organisers — they can create + edit
   * competitions they own. This returns true for Admins (always) and for
   * Trainers regardless of editorMode (no view/edit toggle for trainers).
   * Use for organiser-only surfaces like the comp creator wizard's Save.
   */
  canOrganise: (competition?: { createdByUserId?: string | null }) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EDITOR_MODE_KEY = 'mg.adminEditorMode';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ token: string; kind: 'requested' | 'approved' } | null>(null);
  const token = auth?.token ?? null;
  const pendingTrainer = auth?.user.roles.includes('TrainerRequest') ?? false;
  // Default off: admins land in safe "View only" mode and have to opt into
  // Edit mode explicitly. Persisted so it survives navigation.
  const [editorMode, setEditorModeState] = useState<boolean>(() => {
    try { return !!auth && localStorage.getItem(EDITOR_MODE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get<UserProfile>('/auth/me').then(({ data }) => {
      if (!cancelled && pendingTrainer && data.roles.includes('Trainer')) {
        // Keep the saved roles aligned with the JWT until the next sign-in.
        setNotice({ token, kind: 'approved' });
      }
    }).catch((error: { response?: { status?: number } }) => {
      // A dropped connection does not mean the saved login is invalid.
      if (!cancelled && error.response?.status === 401) {
        setAuth(null);
        setEditorModeState(false);
        writeStoredAuth(null);
      }
    });
    return () => { cancelled = true; };
  }, [token, pendingTrainer]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/login', { email, password });
      writeStoredAuth(data);
      setAuth(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithAdminKey = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/admin-key', { key });
      writeStoredAuth(data);
      setAuth(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const signupTrainer = useCallback(async (username: string, password: string, role?: string, clubName?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/signup-trainer', {
        username, password, role, clubName,
      });
      writeStoredAuth(data);
      setAuth(data);
      setNotice(data.user.roles.includes('TrainerRequest') ? { token: data.token, kind: 'requested' } : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    writeStoredAuth(null);
    setAuth(null);
    setEditorModeState(false);
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
    };
  }, [auth]);

  const hasRole = useCallback((role: Role) => !!user?.roles.includes(role), [user]);

  // Logging out / changing identity should reset Edit mode so the next user
  // doesn't inherit a dangerous unlocked state.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) {
      try { localStorage.removeItem(EDITOR_MODE_KEY); } catch { /* quota */ }
    }
  }, [userId]);

  const setEditorMode = useCallback((v: boolean) => {
    // Only admins can flip the switch; non-admins are pinned to false.
    const next = v && !!user?.roles.includes('Admin');
    setEditorModeState(next);
    try {
      if (next) localStorage.setItem(EDITOR_MODE_KEY, '1');
      else localStorage.removeItem(EDITOR_MODE_KEY);
    } catch { /* quota */ }
  }, [user]);

  const canEdit = useCallback(() => editorMode && hasRole('Admin'), [editorMode, hasRole]);
  // Ownership is also enforced by the API; this hides controls the viewer cannot use.
  const canOrganise = useCallback(
    (competition?: { createdByUserId?: string | null }) => hasRole('Admin')
      || (hasRole('Trainer') && (!competition || competition.createdByUserId === user?.id)),
    [hasRole, user?.id]);

  const value: AuthContextValue = {
    user,
    token: auth?.token ?? null,
    loading,
    trainerNotice: notice && notice.token === token ? notice.kind : null,
    login,
    loginWithAdminKey,
    signupTrainer,
    logout,
    hasRole,
    editorMode,
    setEditorMode,
    canEdit,
    canOrganise,
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
