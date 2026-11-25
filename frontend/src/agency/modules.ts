import { useSyncExternalStore } from 'react';

import type { Module } from '../api/types';

export const MODULE_LABELS: Record<Module, string> = { flights: 'Flights', tours: 'Tours', hotels: 'Hotels' };

let modules: Module[] = ['flights'];
const listeners = new Set<() => void>();

/** Sets the agency's modules, re-rendering what depends on them. */
export function setModules(next: Module[] | undefined) {
  const value = next?.length ? next : ['flights' as const];
  if (JSON.stringify(value) !== JSON.stringify(modules)) {
    modules = value;
    listeners.forEach((listener) => listener());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The agency's modules, in the order flights, tours, hotels. */
export function useModules(): Module[] {
  return useSyncExternalStore(subscribe, () => modules);
}

/** Whether the agency has the module on. */
export function useHasModule(module: Module): boolean {
  return useModules().includes(module);
}
