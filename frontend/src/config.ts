import { Platform } from 'react-native';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL is not set. Copy frontend/.env.example to frontend/.env.');
}

/** The API on a given host: {host} in EXPO_PUBLIC_API_URL becomes that host. */
export function apiUrlFor(host: string): string {
  return apiUrl!.replace('{host}', host).replace(/\/+$/, '');
}

/**
 * Web: each agency has its own hostname with its API on it, so {host} is the page's hostname. Native apps use the
 * stored agency's address instead (see agency/agency.ts).
 */
export const API_URL = apiUrlFor(
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : '',
);

/** Native: the shared app serving every agency, which it learns from links or a typed code. */
export const IS_NATIVE = Platform.OS !== 'web';

/** Agencies' app addresses are <code>.<this>. */
export const TENANT_BASE_DOMAIN = process.env.EXPO_PUBLIC_TENANT_BASE_DOMAIN ?? '';

export const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL ?? '';
export const PLAY_STORE_URL = process.env.EXPO_PUBLIC_PLAY_STORE_URL ?? '';

/** The app's own link scheme, for browsers that do not hand https links to the app. */
export const APP_SCHEME = 'azaria';

/** The root host serves the platform rather than an agency. Web only: native builds always talk to an agency. */
export const PLATFORM_HOST = process.env.EXPO_PUBLIC_PLATFORM_HOST ?? '';

export const IS_PLATFORM =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  !!PLATFORM_HOST &&
  window.location.hostname === PLATFORM_HOST;

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
