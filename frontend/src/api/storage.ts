import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ThemeColors } from '../theme';
import type { Module } from './types';

// localStorage on web, expo-secure-store on native.

const ACCESS_KEY = 'dira.access';
const REFRESH_KEY = 'dira.refresh';
// Native only: the agency the shared app serves, as JSON {code, name, theme}.
const AGENCY_KEY = 'dira.agency';

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const tokenStorage = {
  getAccess: () => getItem(ACCESS_KEY),
  getRefresh: () => getItem(REFRESH_KEY),
  setAccess: (token: string) => setItem(ACCESS_KEY, token),
  async setTokens(access: string, refresh: string) {
    await setItem(ACCESS_KEY, access);
    await setItem(REFRESH_KEY, refresh);
  },
  async clear() {
    await removeItem(ACCESS_KEY);
    await removeItem(REFRESH_KEY);
  },
};

/** The agency the native app serves, with its theme's colours and modules so the app opens with them at once. */
export type StoredAgency = { code: string; name: string; theme: ThemeColors | null; modules: Module[] };

export const agencyStorage = {
  async get(): Promise<StoredAgency | null> {
    const value = await getItem(AGENCY_KEY);
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Partial<StoredAgency>;
      return typeof parsed.code === 'string' && typeof parsed.name === 'string'
        ? { code: parsed.code, name: parsed.name, theme: parsed.theme ?? null, modules: parsed.modules ?? ['flights'] }
        : null;
    } catch {
      return null;
    }
  },
  set: (agency: StoredAgency) => setItem(AGENCY_KEY, JSON.stringify(agency)),
  clear: () => removeItem(AGENCY_KEY),
};
