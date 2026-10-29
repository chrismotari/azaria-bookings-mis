import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { API_URL } from '../config';
import { tokenStorage } from './storage';

export const api = axios.create({ baseURL: API_URL });

// Requests that must never trigger a token refresh.
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

let onSessionExpired: () => void = () => {};

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

api.interceptors.request.use(async (config) => {
  const access = await tokenStorage.getAccess();
  if (access && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  return config;
});

// One refresh shared by every request that fails while it is in flight.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await tokenStorage.getRefresh();
  if (!refresh) {
    return null;
  }
  try {
    const { data } = await axios.post<{ access: string }>(`${API_URL}/auth/refresh`, { refresh });
    await tokenStorage.setAccess(data.access);
    return data.access;
  } catch {
    return null;
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const isAuthPath = AUTH_PATHS.some((path) => config?.url?.startsWith(path));
    if (error.response?.status !== 401 || !config || isAuthPath) {
      throw error;
    }
    if (!config._retried) {
      config._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const access = await refreshing;
      if (access) {
        config.headers.Authorization = `Bearer ${access}`;
        return api(config);
      }
    }
    await tokenStorage.clear();
    onSessionExpired();
    throw error;
  },
);
