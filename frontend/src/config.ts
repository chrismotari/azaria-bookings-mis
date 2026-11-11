import { Platform } from 'react-native';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL is not set. Copy frontend/.env.example to frontend/.env.');
}

/** Each agency has its own hostname with its API on it: {host} in the URL becomes the page's hostname. */
function resolveHost(url: string): string {
  if (!url.includes('{host}')) {
    return url;
  }
  const host = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return url.replace('{host}', host);
}

export const API_URL = resolveHost(apiUrl).replace(/\/+$/, '');

/** The root host serves the platform rather than an agency. Web only: native builds always talk to an agency. */
export const PLATFORM_HOST = process.env.EXPO_PUBLIC_PLATFORM_HOST ?? '';

export const IS_PLATFORM =
  Platform.OS === 'web' && typeof window !== 'undefined' && !!PLATFORM_HOST && window.location.hostname === PLATFORM_HOST;

// The owner signs in only at /login on the root host, so the usual guesses (admin.<host>, <host>/admin/...) go
// there. Runs before the app starts so navigation opens on /login.
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
