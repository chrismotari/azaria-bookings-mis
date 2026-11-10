import { useSyncExternalStore } from 'react';

/** What a new chat starts with, e.g. a plan enquiry from the pricing page. */
export type ChatPrefill = { subject: string; message: string };

type State = { open: boolean; prefill: ChatPrefill | null; version: number };

let state: State = { open: false, prefill: null, version: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next, version: state.version + 1 };
  listeners.forEach((listener) => listener());
}

/** Opens the floating message panel, on a new chat prefilled with this. */
export function openChat(prefill: ChatPrefill | null = null) {
  set({ open: true, prefill });
}

export function closeChat() {
  set({ open: false, prefill: null });
}

export function toggleChat() {
  set({ open: !state.open, prefill: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The floating panel's state, shared so other screens (the pricing page) can open it. */
export function useChatLauncher(): State {
  return useSyncExternalStore(subscribe, () => state);
}
