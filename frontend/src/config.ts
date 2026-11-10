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

/**
 * The system owner's way in is only /login on the root host; nothing on the public pages links there. The usual
 * guesses lead there too: admin.<root host> (e.g. admin.localhost:8081) and <root host>/admin (with anything
 * under it). Done before the app starts, so the navigation opens on /login (or the dashboard when signed in).
 */
function redirectAdminAddresses() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !PLATFORM_HOST) {
    return;
  }
  const { hostname, pathname, protocol, port } = window.location;
  if (hostname === `admin.${PLATFORM_HOST}`) {
    window.location.replace(`${protocol}//${PLATFORM_HOST}${port ? `:${port}` : ''}/login`);
  } else if (hostname === PLATFORM_HOST && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    window.history.replaceState(null, '', '/login');
  }
}

redirectAdminAddresses();

/** Sign-in, refresh and me: the platform's own on the root host, the agency's everywhere else. */
export const AUTH_PATH = IS_PLATFORM ? '/platform' : '/auth';
