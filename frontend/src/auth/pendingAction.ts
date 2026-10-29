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

export function clearPendingAction() {
  pending = null;
}
