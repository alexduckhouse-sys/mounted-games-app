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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth());
  const [loading, setLoading] = useState(false);

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

  const value: AuthContextValue = {
    user,
    token: auth?.token ?? null,
    loading,
    login,
    loginWithAdminKey,
    signupTrainer,
    logout,
    hasRole: (role) => !!user?.roles.includes(role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
