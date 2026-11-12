import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Chat } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TripCard } from '../../components/TripCard';
import { AdminTabParamList, MainTabParamList } from '../../navigation/types';
import {
  AGENCY_REQUESTER,
  AGENCY_TO_PLATFORM,
  ChatEndpoints,
  CHATS_KEY,
  messageBody,
  useMyChat,
  useMyChats,
} from '../../support/api';
import { ChatThread, chatTime } from '../../support/ChatThread';
import { NewChatForm } from '../../support/NewChatForm';
import { colors, font, space, weight } from '../../theme';

/** Account > Support: the customer's chats with their agency. */
export function SupportScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'Support'>) {
  return (
    <SupportChats
      endpoints={AGENCY_REQUESTER}
      selected={route.params?.id}
      select={(id) => navigation.setParams({ id })}
      backLabel="Account"
      onBack={() => navigation.navigate('Account')}
      intro="Your chats with us. Closed chats stay here to read; start a new one to write again."
    />
  );
}

/** Settings > Support: the agency admin's chats with the platform (Azaria Bookings). */
export function AdminSupportScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminSupport'>) {
  return (
    <SupportChats
      endpoints={AGENCY_TO_PLATFORM}
      selected={route.params?.id}
      select={(id) => navigation.setParams({ id })}
      backLabel="Settings"
      onBack={() => navigation.navigate('AdminSettings')}
      intro="Your agency's chats with Azaria Bookings, the platform: questions, plans and billing. Replies also come by email."
    />
  );
}

type SupportChatsProps = {
  endpoints: ChatEndpoints;
  selected: string | undefined;
  select: (id: string | undefined) => void;
  backLabel: string;
  onBack: () => void;
  intro: string;
};

/** Every chat the person started, open and closed; open ones can be answered, and new ones started. */
function SupportChats({ endpoints, selected, select, backLabel, onBack, intro }: SupportChatsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const close = useCallback(() => select(undefined), [select]);
  const chats = useMyChats(endpoints);
  const [creating, setCreating] = useState(false);
  return (
    <DetailLayout
      title="Chat"
      backLabel="All chats"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Support',
        items: chats.data?.map((chat) => ({
          id: chat.id,
          primary: chat.subject,
          secondary: chatTime(chat.last_message_at),
          accessibilityLabel: `${chat.subject}, ${chat.status === 'open' ? 'open' : 'closed'}${chat.unread ? ', unread' : ''}`,
          strong: chat.unread,
        })),
        onSelect: select,
      }}
      detail={selected ? <ChatDetailView key={selected} endpoints={endpoints} id={selected} /> : null}
      list={
        <Screen card>
          <BackLink label={backLabel} onPress={onBack} />
          <View style={styles.header}>
            <Text style={styles.title}>Support</Text>
            <Button title="New chat" icon="add-outline" onPress={() => setCreating(true)} />
          </View>
          <Text style={styles.muted}>{intro}</Text>
          {chats.isPending ? (
            <LoadingState />
          ) : chats.isError ? (
            <ErrorState error={chats.error} onRetry={() => chats.refetch()} />
          ) : chats.data.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title="No chats yet"
              message="Questions? Start a chat and we reply here and by email."
            />
          ) : (
            <View style={styles.cards}>
              {chats.data.map((chat) => (
                <ChatCard key={chat.id} chat={chat} selected={chat.id === selected} onPress={() => select(chat.id)} />
              ))}
            </View>
          )}
          {creating ? (
            <Dialog open title="New chat" size="large" onClose={() => setCreating(false)} footer={null}>
              <NewChatForm
                email={user?.email ?? ''}
                path={endpoints.chats}
                onSent={(chat) => {
                  setCreating(false);
                  void queryClient.invalidateQueries({ queryKey: CHATS_KEY });
                  if (chat) {
                    select(chat.id);
                  }
                }}
              />
            </Dialog>
          ) : null}
        </Screen>
      }
    />
  );
}

function ChatCard({ chat, selected, onPress }: { chat: Chat; selected: boolean; onPress: () => void }) {
  const open = chat.status === 'open';
  return (
    <TripCard
      tone={open ? 'info' : 'neutral'}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${chat.subject}, ${open ? 'open' : 'closed'}${chat.unread ? ', unread' : ''}`}
    >
      <View style={styles.between}>
        <Text style={[styles.subject, chat.unread && styles.unread]} numberOfLines={1}>
          {chat.subject}
        </Text>
        <StatusChip
          label={chat.unread ? 'New reply' : open ? 'Open' : 'Closed'}
          tone={chat.unread ? 'warning' : open ? 'info' : 'neutral'}
        />
      </View>
      <Text style={styles.muted}>Last message {chatTime(chat.last_message_at)}</Text>
    </TripCard>
  );
}

function ChatDetailView({ endpoints, id }: { endpoints: ChatEndpoints; id: string }) {
  const queryClient = useQueryClient();
  const chat = useMyChat(endpoints, id);
  if (chat.isPending) {
    return <LoadingState />;
  }
  if (chat.isError) {
    return <DetailError error={chat.error} onRetry={() => chat.refetch()} notFound="Chat not found" />;
  }
  const open = chat.data.status === 'open';
  return (
    <Card>
      <View style={styles.between}>
        <Text style={styles.section}>{chat.data.subject}</Text>
        <StatusChip label={open ? 'Open' : 'Closed'} tone={open ? 'info' : 'neutral'} />
      </View>
      <Text style={styles.muted}>Replies also go to {chat.data.email}.</Text>
      <ChatThread
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
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  cards: { gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  subject: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text, flexShrink: 1 },
  unread: { fontWeight: weight.heavy },
  muted: { color: colors.muted },
});
