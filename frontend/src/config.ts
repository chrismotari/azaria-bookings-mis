import { Platform } from 'react-native';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL is not set. Copy frontend/.env.example to frontend/.env.');
}

/**
 * Each agency is reached at its own hostname, and its API is on the same host: {host} in
 * EXPO_PUBLIC_API_URL is replaced by the page's hostname (e.g. http://{host}:8000/api).
 */
function resolveHost(url: string): string {
  if (!url.includes('{host}')) {
    return url;
  }
  const host = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return url.replace('{host}', host);
}

export const API_URL = resolveHost(apiUrl).replace(/\/+$/, '');

/**
 * The root host (EXPO_PUBLIC_PLATFORM_HOST, e.g. localhost) is the platform, where the system owner manages
 * agencies, instead of an agency. Web only: native builds always talk to an agency.
 */
export const PLATFORM_HOST = process.env.EXPO_PUBLIC_PLATFORM_HOST ?? '';

export const IS_PLATFORM =
  Platform.OS === 'web' && typeof window !== 'undefined' && !!PLATFORM_HOST && window.location.hostname === PLATFORM_HOST;

/** Sign-in, refresh and me: the platform's own on the root host, the agency's everywhere else. */
export const AUTH_PATH = IS_PLATFORM ? '/platform' : '/auth';
