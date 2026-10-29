import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// localStorage on web, expo-secure-store on native.

const ACCESS_KEY = 'azaria.access';
const REFRESH_KEY = 'azaria.refresh';

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
