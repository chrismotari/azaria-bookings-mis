import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// localStorage on web, expo-secure-store on native.

const ACCESS_KEY = 'azaria.access';
const REFRESH_KEY = 'azaria.refresh';
// Native only: the agency the shared app serves, as JSON {code, name}.
const AGENCY_KEY = 'azaria.agency';

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

export type StoredAgency = { code: string; name: string };

export const agencyStorage = {
  async get(): Promise<StoredAgency | null> {
    const value = await getItem(AGENCY_KEY);
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Partial<StoredAgency>;
      return typeof parsed.code === 'string' && typeof parsed.name === 'string'
        ? { code: parsed.code, name: parsed.name }
        : null;
    } catch {
      return null;
    }
  },
  set: (agency: StoredAgency) => setItem(AGENCY_KEY, JSON.stringify(agency)),
  clear: () => removeItem(AGENCY_KEY),
};
