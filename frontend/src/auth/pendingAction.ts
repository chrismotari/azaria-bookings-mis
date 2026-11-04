import { NavigationTarget } from '../navigation/types';

// The login-required action a guest tried to open. Kept in memory only.
let pending: NavigationTarget | null = null;

export function setPendingAction(target: NavigationTarget) {
  pending = target;
}

export function takePendingAction(): NavigationTarget | null {
  const target = pending;
  pending = null;
  return target;
}

// An admin URL (e.g. from an email) opened while signed out, reopened after the admin signs in.
let pendingPath: string | null = null;

export function setPendingPath(path: string) {
  pendingPath = path;
}

export function takePendingPath(): string | null {
  const path = pendingPath;
  pendingPath = null;
  return path;
}

export function clearPendingAction() {
  pending = null;
  pendingPath = null;
}
