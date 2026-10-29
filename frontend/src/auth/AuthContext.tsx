import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, setSessionExpiredHandler } from '../api/client';
import { tokenStorage } from '../api/storage';
import { AuthResponse, User } from '../api/types';
import { clearPendingAction } from './pendingAction';

export type RegisterData = {
  email: string;
  password: string;
  full_name: string;
  phone: string;
};

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (await tokenStorage.getAccess()) {
        try {
          const { data } = await api.get<User>('/auth/me');
          if (!cancelled) {
            setUser(data);
          }
        } catch {
          await tokenStorage.clear();
        }
      }
      if (!cancelled) {
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (data: AuthResponse) => {
    await tokenStorage.setTokens(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
      return signIn(data);
    },
    [signIn],
  );

  const register = useCallback(
    async (form: RegisterData) => {
      const { data } = await api.post<AuthResponse>('/auth/register', form);
      return signIn(data);
    },
    [signIn],
  );

  const logout = useCallback(() => {
    clearPendingAction();
    setUser(null);
    queryClient.clear();
    void tokenStorage.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient]);

  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
