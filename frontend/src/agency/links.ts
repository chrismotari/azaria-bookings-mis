import { Alert, Linking } from 'react-native';

import { tokenStorage } from '../api/storage';
import { setPendingPath } from '../auth/pendingAction';
import { APP_SCHEME, TENANT_BASE_DOMAIN } from '../config';
import {
  AGENCY_CODE,
  chooseAgency,
  currentAgency,
  findAgency,
  loadStoredAgency,
  markLoaded,
  openLink,
  signOutAndOpen,
} from './agency';

/** A link the app was opened with: the agency it is for and its screen as an azaria:// URL. */
type AgencyLink = { code: string; url: string; path: string };

// Paths that only show the app: the "Get the app" page and the scheme's open link.
const HOME_PATHS = ['app', 'open'];

function toLink(code: string, path: string, query: string): AgencyLink | null {
  if (!AGENCY_CODE.test(code)) {
    return null;
  }
  const cleanPath = HOME_PATHS.includes(path) ? '' : path;
  return { code, path: cleanPath, url: `${APP_SCHEME}://${cleanPath}${query}` };
}

/**
 * https://<code>.<base>/<path>?<query> (universal and app links), or azaria://<path>?agency=<code>&... (the scheme
 * link on the web app's /app page). Anything else, including the root host, is not an agency link.
 */
export function parseAgencyLink(raw: string): AgencyLink | null {
  const https = /^https?:\/\/([^/?#:]+)(?::\d+)?\/?([^?#]*)(\?[^#]*)?/i.exec(raw);
  if (https) {
    const host = https[1].toLowerCase();
    const suffix = `.${TENANT_BASE_DOMAIN}`;
    if (!TENANT_BASE_DOMAIN || !host.endsWith(suffix)) {
      return null;
    }
    const code = host.slice(0, -suffix.length);
    return code.includes('.') ? null : toLink(code, https[2].replace(/\/+$/, ''), https[3] ?? '');
  }
  const scheme = new RegExp(`^${APP_SCHEME}://([^?#]*)(\\?[^#]*)?`, 'i').exec(raw);
  if (scheme) {
    const params = (scheme[2] ?? '').replace(/^\?/, '').split('&').filter(Boolean);
    const agency = params.find((param) => param.startsWith('agency='));
    const rest = params.filter((param) => param !== agency);
    if (!agency) {
      return null;
    }
    return toLink(
      decodeURIComponent(agency.slice('agency='.length)).toLowerCase(),
      scheme[1].replace(/^\/+|\/+$/g, ''),
      rest.length ? `?${rest.join('&')}` : '',
    );
  }
  return null;
}

function ask(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// Password reset and set-password links both open this screen.
const PASSWORD_PATH = 'reset-password';

async function handleLink(raw: string) {
  const link = parseAgencyLink(raw);
  if (!link) {
    Alert.alert('Link not opened', "This link isn't for an agency, so the app can't open it.");
    return;
  }
  const signedIn = (await tokenStorage.getAccess()) !== null;
  const current = currentAgency();
  if (current?.code === link.code) {
    if (signedIn && link.path === PASSWORD_PATH) {
      if (await ask('Sign out and continue?', 'This link sets a password, which needs you signed out.', 'Sign out')) {
        await signOutAndOpen(link.url);
      }
      return;
    }
    // An admin page while signed out: reopened after sign-in, as on the web.
    if (!signedIn && link.path.startsWith('admin')) {
      setPendingPath(`/${link.url.slice(`${APP_SCHEME}://`.length)}`);
    }
    openLink(link.url);
    return;
  }
  let agency;
  try {
    agency = await findAgency(link.code);
  } catch (error) {
    Alert.alert('Link not opened', (error as Error).message);
    return;
  }
  if (current) {
    const switching = await ask(
      `Switch to ${agency.name}?`,
      `This link is for ${agency.name}. You're using ${current.name}. Switch to ${agency.name}? You'll be signed out.`,
      'Switch',
    );
    if (!switching) {
      return;
    }
  }
  if (link.path.startsWith('admin')) {
    setPendingPath(`/${link.url.slice(`${APP_SCHEME}://`.length)}`);
  }
  await chooseAgency(agency, link.url);
}

// One link at a time: a second one waits for the first's questions to be answered.
let queue: Promise<void> = Promise.resolve();

function enqueue(url: string) {
  queue = queue.then(() => handleLink(url)).catch(() => undefined);
}

/**
 * Native start-up: loads the stored agency, handles the link the app was opened with (before anything shows, so it
 * can open its screen straight away) and every later link. Returns the unsubscribe function.
 */
export function startAgencyLinks(): () => void {
  queue = loadStoredAgency()
    .then(() => Linking.getInitialURL())
    .then((url) => (url ? handleLink(url) : undefined))
    .catch(() => undefined)
    .finally(markLoaded);
  const subscription = Linking.addEventListener('url', ({ url }) => enqueue(url));
  return () => subscription.remove();
}
