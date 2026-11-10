import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { Chat } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PressState } from '../components/pressState';
import { EmptyState, ErrorState, LoadingState } from '../components/StatusViews';
import { colors, font, radius, shadowRaised, space, useIsWide, weight } from '../theme';
import { ChatEndpoints, CHATS_KEY, messageBody, useMyChat, useMyChats, useMyUnread } from './api';
import { ChatThread, chatTime } from './ChatThread';
import { ChatPrefill, closeChat, openChat, useChatLauncher } from './launcher';
import { NewChatForm } from './NewChatForm';

type View_ = { name: 'list' } | { name: 'new' } | { name: 'thread'; id: string } | { name: 'sent'; email: string };

// Clears the bottom tab bar on phones.
const NARROW_OFFSET = 72;

/**
 * The floating message button on every page for people who write to this host's desk (guests and customers on an
 * agency's site, visitors on the root host). It opens a panel: a signed-in person's open chats and threads, or a
 * guest's new chat form. Other screens open it through openChat (e.g. a plan enquiry).
 */
export function ChatLauncher({ endpoints }: { endpoints: ChatEndpoints }) {
  const { user } = useAuth();
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();
  const launcher = useChatLauncher();
  const open = launcher.open;
  // Only hosts whose requesters can read chats back (an agency's site) have a signed-in mode.
  const signedIn = !!user && !!endpoints.unread;
  const unread = useMyUnread(endpoints, signedIn);
  const [view, setView] = useState<View_>(signedIn ? { name: 'list' } : { name: 'new' });

  // Each opening starts on the list (signed in) or a new chat (guests, or a prefilled enquiry).
  useEffect(() => {
    if (launcher.open) {
      setView(signedIn && !launcher.prefill ? { name: 'list' } : { name: 'new' });
    }
  }, [launcher.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = unread.data ?? 0;
  const panel = (
    <Panel
      key={launcher.version}
      endpoints={endpoints}
      prefill={launcher.prefill}
      view={view}
      setView={setView}
      onClose={closeChat}
      signedIn={signedIn}
      email={user?.email ?? ''}
    />
  );

  return (
    <>
      {open && isWide ? (
        <View style={[styles.panelWide, { bottom: space.lg + 64 + insets.bottom }]}>{panel}</View>
      ) : null}
      {open && !isWide ? (
        <Modal visible animationType="slide" onRequestClose={closeChat}>
          <View style={[styles.panelNarrow, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{panel}</View>
        </Modal>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close messages' : count ? `Messages, ${count} unread` : 'Messages'}
        onPress={() => (open ? closeChat() : openChat())}
        style={({ hovered, pressed }: PressState) => [
          styles.button,
          { bottom: (isWide ? space.lg : NARROW_OFFSET) + insets.bottom },
          (hovered || pressed) && styles.buttonHovered,
        ]}
      >
        <Icon name={open ? 'close' : 'chatbubble-ellipses'} size={26} color={colors.primaryText} />
        {count && !open ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
          </View>
        ) : null}
      </Pressable>
    </>
  );
}

type PanelProps = {
  endpoints: ChatEndpoints;
  prefill: ChatPrefill | null;
  view: View_;
  setView: (view: View_) => void;
  onClose: () => void;
  signedIn: boolean;
  email: string;
};

function Panel({ endpoints, prefill, view, setView, onClose, signedIn, email }: PanelProps) {
  const queryClient = useQueryClient();
  const back = signedIn && view.name !== 'list' ? () => setView({ name: 'list' }) : null;
  const title =
    view.name === 'new'
      ? 'New message'
      : view.name === 'sent'
        ? 'Message sent'
        : view.name === 'thread'
          ? 'Chat'
          : 'Messages';
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            onPress={back}
            style={styles.headerButton}
          >
            <Icon name="chevron-back" size={20} color={colors.primaryText} />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close messages"
          onPress={onClose}
          style={styles.headerButton}
        >
          <Icon name="close" size={20} color={colors.primaryText} />
        </Pressable>
      </View>
      {view.name === 'list' ? (
        <ChatList
          endpoints={endpoints}
          onOpen={(chat) => setView({ name: 'thread', id: chat.id })}
          onNew={() => setView({ name: 'new' })}
        />
      ) : view.name === 'new' ? (
        <ScrollView contentContainerStyle={styles.body}>
          {!signedIn ? <Text style={styles.muted}>Send us a message and we will reply by email.</Text> : null}
          <NewChatForm
            email={email}
            path={endpoints.chats}
            subject={prefill?.subject}
            message={prefill?.message}
            onSent={(chat, sentTo) => {
              void queryClient.invalidateQueries({ queryKey: CHATS_KEY });
              setView(chat ? { name: 'thread', id: chat.id } : { name: 'sent', email: sentTo });
            }}
          />
        </ScrollView>
      ) : view.name === 'sent' ? (
        <View style={styles.body}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="Thanks!"
            message={`We will reply by email to ${view.email}.`}
          />
          <Button title="Send another message" variant="secondary" onPress={() => setView({ name: 'new' })} />
        </View>
      ) : (
        <Thread endpoints={endpoints} id={view.id} />
      )}
    </View>
  );
}

function ChatList({
  endpoints,
  onOpen,
  onNew,
}: {
  endpoints: ChatEndpoints;
  onOpen: (chat: Chat) => void;
  onNew: () => void;
}) {
  const chats = useMyChats(endpoints, 'open');
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Button title="New chat" icon="add-outline" onPress={onNew} />
      {chats.isPending ? (
        <LoadingState />
      ) : chats.isError ? (
        <ErrorState error={chats.error} onRetry={() => chats.refetch()} />
      ) : chats.data.length === 0 ? (
        <Text style={styles.muted}>No open chats. Closed chats are under Account › Support.</Text>
      ) : (
        chats.data.map((chat) => (
          <Pressable
            key={chat.id}
            accessibilityRole="link"
            accessibilityLabel={`${chat.subject}${chat.unread ? ', unread' : ''}`}
            onPress={() => onOpen(chat)}
            style={({ hovered }: PressState) => [styles.row, hovered && styles.rowHovered]}
          >
            <View style={styles.rowMain}>
              <Text style={[styles.subject, chat.unread && styles.subjectUnread]} numberOfLines={1}>
                {chat.subject}
              </Text>
              <Text style={styles.muted}>{chatTime(chat.last_message_at)}</Text>
            </View>
            {chat.unread ? <View style={styles.dot} /> : null}
            <Icon name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function Thread({ endpoints, id }: { endpoints: ChatEndpoints; id: string }) {
  const queryClient = useQueryClient();
  const chat = useMyChat(endpoints, id);
  if (chat.isPending) {
    return <LoadingState />;
  }
  if (chat.isError) {
    return <ErrorState error={chat.error} onRetry={() => chat.refetch()} />;
  }
  const open = chat.data.status === 'open';
  return (
    <View style={[styles.body, styles.fill]}>
      <Text style={styles.subject}>{chat.data.subject}</Text>
      <ChatThread
        scroll
        attachments={endpoints.attachments}
        side="requester"
        messages={chat.data.messages}
        closedNote="This chat is closed. Start a new one to write again."
        onSend={
          open
            ? async (body, attachment) => {
                await api.post(`${endpoints.chats}/${id}/messages`, messageBody({ body }, attachment));
                await queryClient.invalidateQueries({ queryKey: CHATS_KEY });
              }
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowRaised,
    zIndex: 20,
  },
  buttonHovered: { opacity: 0.92 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.accentText, fontSize: font.caption, fontWeight: weight.bold },
  panelWide: {
    position: 'absolute',
    right: space.lg,
    width: 380,
    height: 560,
    maxHeight: '80%',
    zIndex: 20,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowRaised,
  },
  panelNarrow: { flex: 1, backgroundColor: colors.surface },
  panel: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: colors.primary,
  },
  headerButton: { padding: space.xs },
  title: { flex: 1, color: colors.primaryText, fontSize: font.heading, fontWeight: weight.bold },
  body: { padding: space.lg, gap: space.md },
  fill: { flex: 1, minHeight: 0 },
  muted: { color: colors.muted, fontSize: font.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHovered: { backgroundColor: colors.background },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  subject: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  subjectUnread: { fontWeight: weight.heavy },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});
