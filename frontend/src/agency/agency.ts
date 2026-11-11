import axios, { isAxiosError } from 'axios';
import { useSyncExternalStore } from 'react';

import { agencyStorage, StoredAgency, tokenStorage } from '../api/storage';
import { resetTenantProblem } from '../api/tenant';
import { AgencyInfo } from '../api/types';
import { clearPendingAction } from '../auth/pendingAction';
import { API_URL, apiUrlFor, IS_NATIVE, TENANT_BASE_DOMAIN } from '../config';

/**
 * The agency the shared native app serves, stored with the sign-in tokens. On the web the address decides the
 * agency and none of this applies: the state is always "loaded" and the API is the page's own.
 */
type State = {
  agency: StoredAgency | null;
  loaded: boolean;
  /** Bumped whenever the agency or the session is replaced: the app below the agency gate starts afresh. */
  session: number;
};

let state: State = { agency: null, loaded: !IS_NATIVE, session: 0 };
const listeners = new Set<() => void>();

function update(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgencyState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function currentAgency(): StoredAgency | null {
  return state.agency;
}

/** An agency's app address: <code>.<base>. */
export function agencyAddress(code: string): string {
  return `${code}.${TENANT_BASE_DOMAIN}`;
}

/** The API every request goes to: the page's host on the web, the stored agency's address on native. */
export function currentApiUrl(): string {
  return IS_NATIVE && state.agency ? apiUrlFor(agencyAddress(state.agency.code)) : API_URL;
}

export async function loadStoredAgency(): Promise<void> {
  update({ agency: await agencyStorage.get() });
}

export function markLoaded() {
  update({ loaded: true });
}

/** What customers type: the agency's address label, 3–30 lowercase letters, digits and hyphens. */
export const AGENCY_CODE = /^[a-z][a-z0-9-]{2,29}$/;

/** Checks a code with GET /agency on that agency's address. Throws an Error with a message for the user. */
export async function findAgency(code: string): Promise<AgencyInfo> {
  try {
    const { data } = await axios.get<AgencyInfo>(`${apiUrlFor(agencyAddress(code))}/agency`, { timeout: 15000 });
    return data;
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      const body = (error.response.data ?? {}) as { code?: unknown; detail?: unknown };
      if (body.code === 'tenant_suspended') {
        throw new Error(typeof body.detail === 'string' ? body.detail : 'This agency is not available at the moment.');
      }
      if (body.code === 'no_tenant' || error.response.status === 404) {
        throw new Error(`No agency uses the code "${code}". Check the code with your agency.`);
      }
    }
    throw new Error("We couldn't reach your agency. Check your connection and try again.");
  }
}

// A link's screen waiting for the navigation to start (or start afresh), as an azaria:// URL.
let pendingUrl: string | null = null;
// The navigation's link listener while it is mounted.
let deliver: ((url: string) => void) | null = null;

/** Opens a link's screen now if the navigation is up, or as soon as it starts. */
export function openLink(url: string | null) {
  if (url && deliver) {
    deliver(url);
  } else {
    pendingUrl = url;
  }
}

/** For the navigation's linking options (native). */
export const nativeLinking = {
  getInitialURL(): string | null {
    const url = pendingUrl;
    pendingUrl = null;
    return url;
  },
  subscribe(listener: (url: string) => void) {
    deliver = listener;
    return () => {
      if (deliver === listener) {
        deliver = null;
      }
    };
  },
};

async function signOutEverywhere() {
  clearPendingAction();
  await tokenStorage.clear();
  resetTenantProblem();
}

/** Stores an agency (signing out of any other) and starts the app on it, opening url's screen if given. */
export async function chooseAgency(agency: AgencyInfo, url: string | null = null) {
  await signOutEverywhere();
  const stored = { code: agency.code, name: agency.name };
  await agencyStorage.set(stored);
  pendingUrl = url;
  update({ agency: stored, session: state.session + 1 });
}

/** Signs out and opens url's screen on the same agency, e.g. a password link opened while signed in. */
export async function signOutAndOpen(url: string) {
  await signOutEverywhere();
  pendingUrl = url;
  update({ session: state.session + 1 });
}

/** "Switch agency": signs out, forgets the agency and returns to Find your agency. */
export async function switchAgency() {
  await signOutEverywhere();
  await agencyStorage.clear();
  pendingUrl = null;
  update({ agency: null, session: state.session + 1 });
}
