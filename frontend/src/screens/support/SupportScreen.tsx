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
import { DetailLayout } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TripCard } from '../../components/TripCard';
import { MainTabParamList } from '../../navigation/types';
import { CHATS_KEY, messageBody, useMyChat, useMyChats } from '../../support/api';
import { ChatThread, chatTime } from '../../support/ChatThread';
import { NewChatForm } from '../../support/NewChatForm';
import { colors, font, space, weight } from '../../theme';

/** Every chat the customer started, open and closed; open ones can be answered, and new ones started. */
export function SupportScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'Support'>) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const chats = useMyChats();
  const [creating, setCreating] = useState(false);
  return (
    <DetailLayout
      title="Chat"
      backLabel="All chats"
      onClose={close}
      detail={selected ? <ChatDetailView key={selected} id={selected} /> : null}
      list={
        <Screen card>
          <BackLink label="Account" onPress={() => navigation.navigate('Account')} />
          <View style={styles.header}>
            <Text style={styles.title}>Support</Text>
            <Button title="New chat" icon="add-outline" onPress={() => setCreating(true)} />
          </View>
          <Text style={styles.muted}>
            Your chats with us. Closed chats stay here to read; start a new one to write again.
          </Text>
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
                <ChatCard
                  key={chat.id}
                  chat={chat}
                  selected={chat.id === selected}
                  onPress={() => navigation.setParams({ id: chat.id })}
                />
              ))}
            </View>
          )}
          {creating ? (
            <Dialog open title="New chat" size="large" onClose={() => setCreating(false)} footer={null}>
              <NewChatForm
                email={user?.email ?? ''}
                onSent={(chat) => {
                  setCreating(false);
                  void queryClient.invalidateQueries({ queryKey: CHATS_KEY });
                  if (chat) {
                    navigation.setParams({ id: chat.id });
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

function ChatDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const chat = useMyChat(id);
  if (chat.isPending) {
    return <LoadingState />;
  }
  if (chat.isError) {
    return <ErrorState error={chat.error} onRetry={() => chat.refetch()} />;
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
        side="requester"
        messages={chat.data.messages}
        closedNote="This chat is closed. Start a new one to write again."
        onSend={
          open
            ? async (body, attachment) => {
                await api.post(`/support/chats/${id}/messages`, messageBody({ body }, attachment));
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
