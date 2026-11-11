import { useSyncExternalStore } from 'react';

import { IS_PLATFORM } from '../config';

/** Set when the API says this address has no agency (no_tenant) or the agency is suspended (tenant_suspended). */
let problem: string | null = null;
const listeners = new Set<() => void>();

const TENANT_CODES = ['no_tenant', 'tenant_suspended'];

/** Records a tenant error from an API response body; returns whether it was one. */
export function reportTenantProblem(body: unknown): boolean {
  const { code, detail } = (body ?? {}) as { code?: unknown; detail?: unknown };
  // The platform is not an agency: it never shows the no-agency page.
  if (IS_PLATFORM || typeof code !== 'string' || !TENANT_CODES.includes(code)) {
    return false;
  }
  if (problem === null) {
    problem = typeof detail === 'string' ? detail : 'This agency is not available.';
    listeners.forEach((listener) => listener());
  }
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server's message when the app cannot be used at this address, otherwise null. */
export function useTenantProblem(): string | null {
  return useSyncExternalStore(subscribe, () => problem);
}

/** A newly chosen agency (native) starts without the previous one's problem. */
export function resetTenantProblem() {
  if (problem !== null) {
    problem = null;
    listeners.forEach((listener) => listener());
  }
}
