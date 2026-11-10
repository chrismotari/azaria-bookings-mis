import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import { Chat, ChatDetail, DeskChat, DeskChatDetail, Paginated } from '../api/types';

/** Polling, until websockets replace it: an open thread, and the unread badges. */
export const THREAD_POLL_MS = 10_000;
export const BADGE_POLL_MS = 30_000;

export const CHATS_KEY = ['support', 'chats'];
export const DESK_KEY = ['support', 'desk'];

/** A message (and its optional attachment) as the multipart body the API takes. */
export function messageBody(fields: Record<string, string>, attachment: File | null): FormData {
  const body = new FormData();
  Object.entries(fields).forEach(([name, value]) => body.append(name, value));
  if (attachment) {
    body.append('attachment', attachment);
  }
  return body;
}

export function useMyChats(status?: 'open') {
  return useQuery({
    queryKey: [...CHATS_KEY, 'list', status ?? 'all'],
    queryFn: async () =>
      (await api.get<Paginated<Chat>>('/support/chats', { params: status ? { status } : {} })).data.results,
  });
}

export function useMyChat(id: string) {
  return useQuery({
    queryKey: [...CHATS_KEY, 'detail', id],
    queryFn: async () => (await api.get<ChatDetail>(`/support/chats/${id}`)).data,
    refetchInterval: THREAD_POLL_MS,
  });
}

export function useMyUnread(enabled: boolean) {
  return useQuery({
    queryKey: [...CHATS_KEY, 'unread'],
    queryFn: async () => (await api.get<{ count: number }>('/support/unread')).data.count,
    refetchInterval: BADGE_POLL_MS,
    enabled,
  });
}

export function useDeskChats(status: 'open' | 'closed', page: number) {
  return useQuery({
    queryKey: [...DESK_KEY, 'list', status, page],
    queryFn: async () => (await api.get<Paginated<DeskChat>>('/admin/chats', { params: { status, page } })).data,
    refetchInterval: BADGE_POLL_MS,
  });
}

export function useDeskChat(id: string) {
  return useQuery({
    queryKey: [...DESK_KEY, 'detail', id],
    queryFn: async () => (await api.get<DeskChatDetail>(`/admin/chats/${id}`)).data,
    refetchInterval: THREAD_POLL_MS,
  });
}

export function useDeskUnread(enabled = true) {
  return useQuery({
    queryKey: [...DESK_KEY, 'unread'],
    queryFn: async () => (await api.get<{ count: number }>('/admin/chats/unread')).data.count,
    refetchInterval: BADGE_POLL_MS,
    enabled,
  });
}
