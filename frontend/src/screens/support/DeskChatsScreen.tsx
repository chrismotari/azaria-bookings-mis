import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { DeskChat } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DetailLayout } from '../../components/DetailLayout';
import { FormError } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TripCard } from '../../components/TripCard';
import { AdminTabParamList, PlatformTabParamList } from '../../navigation/types';
import {
  AGENCY_DESK,
  DESK_KEY,
  DeskEndpoints,
  messageBody,
  PLATFORM_DESK,
  useDeskChat,
  useDeskChats,
} from '../../support/api';
import { ChatThread, chatTime } from '../../support/ChatThread';
import { colors, font, space, weight } from '../../theme';

type Status = 'open' | 'closed';

const FILTERS: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

export function DeskChatsScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminChats'>) {
  return (
    <DeskChats
      endpoints={AGENCY_DESK}
      selected={route.params?.id}
      select={(id) => navigation.setParams({ id })}
      intro="Messages from your site's visitors and customers. Chats close by themselves 48 hours after their last message."
    />
  );
}

export function PlatformChatsScreen({
  navigation,
  route,
}: BottomTabScreenProps<PlatformTabParamList, 'PlatformChats'>) {
  return (
    <DeskChats
      endpoints={PLATFORM_DESK}
      selected={route.params?.id}
      select={(id) => navigation.setParams({ id })}
      intro="Messages from visitors to the platform's pages (plan enquiries among them) and from agencies' admins. Chats close by themselves 48 hours after their last message."
    />
  );
}

type DeskChatsProps = {
  endpoints: DeskEndpoints;
  selected: string | undefined;
  select: (id: string | undefined) => void;
  intro: string;
};

/** Chats, unread first; reply and close. */
function DeskChats({ endpoints, selected, select, intro }: DeskChatsProps) {
  const close = useCallback(() => select(undefined), [select]);
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(1);
  const chats = useDeskChats(endpoints, status, page);
  return (
    <DetailLayout
      title="Chat"
      backLabel="All chats"
      onClose={close}
      detail={selected ? <DeskChatView key={selected} endpoints={endpoints} id={selected} /> : null}
      list={
        <Screen card>
          <Text style={styles.title}>Chats</Text>
          <Text style={styles.muted}>{intro}</Text>
          <SegmentedControl
            label="Status"
            options={FILTERS}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          {chats.isPending ? (
            <LoadingState />
          ) : chats.isError ? (
            <ErrorState error={chats.error} onRetry={() => chats.refetch()} />
          ) : chats.data.results.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title={status === 'open' ? 'No open chats' : 'No closed chats'}
              message={
                status === 'open'
                  ? 'New messages from the message button on your site show here.'
                  : 'Closed chats are kept here.'
              }
            />
          ) : (
            <>
              <View style={styles.cards}>
                {chats.data.results.map((chat) => (
                  <DeskChatCard
                    key={chat.id}
                    chat={chat}
                    selected={chat.id === selected}
                    onPress={() => select(chat.id)}
                  />
                ))}
              </View>
              <Pagination page={page} count={chats.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

/** "Guest · email" or "Name · email", with the agency on the platform's desk. */
const requesterLabel = (chat: DeskChat) =>
  `${chat.is_guest ? 'Guest' : chat.name}${chat.agency ? ` (${chat.agency.name})` : ''} · ${chat.email}`;

function DeskChatCard({ chat, selected, onPress }: { chat: DeskChat; selected: boolean; onPress: () => void }) {
  return (
    <TripCard
      tone={chat.unread ? 'warning' : chat.status === 'open' ? 'info' : 'neutral'}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${chat.subject}, ${requesterLabel(chat)}${chat.unread ? ', unread' : ''}`}
    >
      <View style={styles.between}>
        <Text style={[styles.subject, chat.unread && styles.unread]} numberOfLines={1}>
          {chat.subject}
        </Text>
        {chat.unread ? (
          <StatusChip label="Unread" tone="warning" />
        ) : chat.is_guest ? (
          <StatusChip label="Guest" tone="neutral" />
        ) : null}
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {requesterLabel(chat)}
      </Text>
      <Text style={styles.muted}>Last message {chatTime(chat.last_message_at)}</Text>
    </TripCard>
  );
}

function DeskChatView({ endpoints, id }: { endpoints: DeskEndpoints; id: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const chat = useDeskChat(endpoints, id);
  const refresh = () => queryClient.invalidateQueries({ queryKey: DESK_KEY });
  const closeChat = useMutation({
    mutationFn: async () => api.post(`${endpoints.chats}/${id}/close`),
    onSuccess: refresh,
  });
  if (chat.isPending) {
    return <LoadingState />;
  }
  if (chat.isError) {
    return <ErrorState error={chat.error} onRetry={() => chat.refetch()} />;
  }
  const data = chat.data;
  const open = data.status === 'open';
  const onClose = async () => {
    if (
      await confirm({
        title: 'Close this chat?',
        message: 'It leaves the person’s open chats and cannot be written to again. They can start a new chat.',
        confirmLabel: 'Close chat',
        tone: 'danger',
      })
    ) {
      closeChat.mutate();
    }
  };
  return (
    <>
      {open ? (
        <ActionBar>
          <Button title="Close chat" variant="danger" onPress={onClose} loading={closeChat.isPending} />
        </ActionBar>
      ) : null}
      <FormError message={closeChat.isError ? errorMessage(closeChat.error) : null} />
      <Card>
        <View style={styles.between}>
          <Text style={styles.section}>{data.subject}</Text>
          <StatusChip label={open ? 'Open' : 'Closed'} tone={open ? 'info' : 'neutral'} />
        </View>
        <Text style={styles.text}>{requesterLabel(data)}</Text>
        {data.is_guest ? (
          <Text style={styles.muted}>A guest: your replies reach them by email only, and they cannot answer here.</Text>
        ) : null}
        {!open ? (
          <Text style={styles.muted}>
            Closed {data.closed_at ? chatTime(data.closed_at) : ''}
            {data.closed_by_name ? ` by ${data.closed_by_name}` : ' after 48 hours without messages'}.
          </Text>
        ) : null}
        <ChatThread
          attachments={endpoints.attachments}
          side="desk"
          messages={data.messages}
          closedNote="This chat is closed."
          onSend={
            open
              ? async (body, attachment) => {
                  await api.post(`${endpoints.chats}/${id}/messages`, messageBody({ body }, attachment));
                  await refresh();
                }
              : null
          }
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  cards: { gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  subject: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text, flexShrink: 1 },
  unread: { fontWeight: weight.heavy },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
