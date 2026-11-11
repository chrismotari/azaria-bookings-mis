import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import { Chat, ChatDetail, DeskChat, DeskChatDetail, Paginated } from '../api/types';

const THREAD_POLL_MS = 10_000;
const BADGE_POLL_MS = 30_000;

export const CHATS_KEY = ['support', 'chats'];
export const DESK_KEY = ['support', 'desk'];

/** Where one side of one desk is reached. */
export type ChatEndpoints = {
  /** Chats: GET (the requester's), POST (a new one); <chats>/<id>, <chats>/<id>/messages, <chats>/unread or unread. */
  chats: string;
  unread: string;
  attachments: string;
};

/** Guests and customers on an agency's site, writing to the agency. */
export const AGENCY_REQUESTER: ChatEndpoints = {
  chats: '/support/chats',
  unread: '/support/unread',
  attachments: '/support/attachments',
};

/** An agency's admins, writing to the platform from their own site. */
export const AGENCY_TO_PLATFORM: ChatEndpoints = {
  chats: '/support/platform-chats',
  unread: '/support/platform-chats/unread',
  attachments: '/support/platform-attachments',
};

/** Visitors on the root host, writing to the platform (guests only: they cannot read chats back). */
export const PLATFORM_VISITOR: ChatEndpoints = {
  chats: '/platform/support/chats',
  unread: '',
  attachments: '/platform/support/attachments',
};

/** The desk side: an agency's admins, or the system owner. */
export type DeskEndpoints = { chats: string; attachments: string };

export const AGENCY_DESK: DeskEndpoints = { chats: '/admin/chats', attachments: '/support/attachments' };
export const PLATFORM_DESK: DeskEndpoints = { chats: '/platform/chats', attachments: '/platform/support/attachments' };

/** A message (and its optional attachment) as the multipart body the API takes. */
export function messageBody(fields: Record<string, string>, attachment: File | null): FormData {
  const body = new FormData();
  Object.entries(fields).forEach(([name, value]) => body.append(name, value));
  if (attachment) {
    body.append('attachment', attachment);
  }
  return body;
}

export function useMyChats(endpoints: ChatEndpoints, status?: 'open') {
  return useQuery({
    queryKey: [...CHATS_KEY, endpoints.chats, 'list', status ?? 'all'],
    queryFn: async () =>
      (await api.get<Paginated<Chat>>(endpoints.chats, { params: status ? { status } : {} })).data.results,
  });
}

export function useMyChat(endpoints: ChatEndpoints, id: string) {
  return useQuery({
    queryKey: [...CHATS_KEY, endpoints.chats, 'detail', id],
    queryFn: async () => (await api.get<ChatDetail>(`${endpoints.chats}/${id}`)).data,
    refetchInterval: THREAD_POLL_MS,
  });
}

export function useMyUnread(endpoints: ChatEndpoints, enabled: boolean) {
  return useQuery({
    queryKey: [...CHATS_KEY, endpoints.chats, 'unread'],
    queryFn: async () => (await api.get<{ count: number }>(endpoints.unread)).data.count,
    refetchInterval: BADGE_POLL_MS,
    enabled: enabled && !!endpoints.unread,
  });
}

export function useDeskChats(endpoints: DeskEndpoints, status: 'open' | 'closed', page: number) {
  return useQuery({
    queryKey: [...DESK_KEY, endpoints.chats, 'list', status, page],
    queryFn: async () => (await api.get<Paginated<DeskChat>>(endpoints.chats, { params: { status, page } })).data,
    refetchInterval: BADGE_POLL_MS,
  });
}

export function useDeskChat(endpoints: DeskEndpoints, id: string) {
  return useQuery({
    queryKey: [...DESK_KEY, endpoints.chats, 'detail', id],
    queryFn: async () => (await api.get<DeskChatDetail>(`${endpoints.chats}/${id}`)).data,
    refetchInterval: THREAD_POLL_MS,
  });
}

export function useDeskUnread(endpoints: DeskEndpoints, enabled = true) {
  return useQuery({
    queryKey: [...DESK_KEY, endpoints.chats, 'unread'],
    queryFn: async () => (await api.get<{ count: number }>(`${endpoints.chats}/unread`)).data.count,
    refetchInterval: BADGE_POLL_MS,
    enabled,
  });
}
