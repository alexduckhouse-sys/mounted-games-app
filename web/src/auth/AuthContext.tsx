import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, readStoredAuth, writeStoredAuth, type StoredAuth } from '../api';
import type { Role, UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithAdminKey: (key: string) => Promise<void>;
  signupTrainer: (username: string, password: string) => Promise<void>;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EDITOR_MODE_KEY = 'mg.adminEditorMode';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth());
  const [loading, setLoading] = useState(false);
  // Default off: admins land in safe "View only" mode and have to opt into
  // Edit mode explicitly. Persisted so it survives navigation.
  const [editorMode, setEditorModeState] = useState<boolean>(() => {
    try { return localStorage.getItem(EDITOR_MODE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!auth) return;
    api.get('/auth/me').catch(() => {
      setAuth(null);
      writeStoredAuth(null);
    });
  }, [auth?.token]);

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

  const signupTrainer = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<StoredAuth>('/auth/signup-trainer', { username, password });
      writeStoredAuth(data);
      setAuth(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    writeStoredAuth(null);
    setAuth(null);
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
  useEffect(() => {
    if (!user) {
      setEditorModeState(false);
      try { localStorage.removeItem(EDITOR_MODE_KEY); } catch { /* quota */ }
    }
  }, [user?.id]);

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

  const value: AuthContextValue = {
    user,
    token: auth?.token ?? null,
    loading,
    login,
    loginWithAdminKey,
    signupTrainer,
    logout,
    hasRole,
    editorMode,
    setEditorMode,
    canEdit,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
