import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, type User } from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(tokenStore.get());
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  // On page load, check the saved token is still valid.
  useEffect(() => {
    if (!token) return;
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => {
        tokenStore.set(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = useCallback((result: { token: string; user: User }) => {
    tokenStore.set(result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      login: async (email, password) => accept(await api.login(email, password)),
      register: async (email, name, password) => accept(await api.register(email, name, password)),
      logout: () => {
        tokenStore.set(null);
        setToken(null);
        setUser(null);
      },
    }),
    [user, token, loading, accept],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
