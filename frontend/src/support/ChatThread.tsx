import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../api/errors';
import { ChatMessage } from '../api/types';
import { Button } from '../components/Button';
import { FormError } from '../components/Field';
import { Icon } from '../components/Icon';
import { PressState } from '../components/pressState';
import { TextField } from '../components/TextField';
import { colors, font, radius, space, weight } from '../theme';
import { openFile } from '../utils/download';
import { AttachButton } from './AttachButton';

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Nairobi',
});

/** e.g. "10 Nov, 14:05" (Nairobi time). */
export const chatTime = (iso: string) => timeFormat.format(new Date(iso));

type Props = {
  messages: ChatMessage[];
  /** Whose side the reader is on: their own messages are on the right. */
  side: 'requester' | 'desk';
  /** Null hides the reply box (a closed chat, or a guest's chat seen by the requester). */
  onSend: ((body: string, attachment: File | null) => Promise<unknown>) | null;
  /** Shown instead of the reply box when there is none. */
  closedNote?: string;
  /** Keeps the newest message in view inside a bounded box (the floating panel). */
  scroll?: boolean;
  /** Where attachments open: <attachments>/<message id>. */
  attachments: string;
};

export function ChatThread({ messages, side, onSend, closedNote, scroll, attachments }: Props) {
  const list = useRef<ScrollViewInstance | null>(null);
  useEffect(() => {
    list.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  const bubbles = messages.map((message) => {
    const mine = side === 'desk' ? message.from_staff : !message.from_staff;
    return (
      <View key={message.id} style={[styles.message, mine ? styles.mine : styles.theirs]}>
        <Text style={styles.meta}>
          {message.author_name || (message.from_staff ? 'Support' : 'Guest')} · {chatTime(message.created_at)}
        </Text>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={styles.body}>{message.body}</Text>
          {message.has_attachment ? <Attachment message={message} base={attachments} /> : null}
        </View>
      </View>
    );
  });

  return (
    <View style={[styles.thread, scroll && styles.fill]}>
      {scroll ? (
        <ScrollView ref={list} style={styles.fill} contentContainerStyle={styles.messages}>
          {bubbles}
        </ScrollView>
      ) : (
        <View style={styles.messages}>{bubbles}</View>
      )}
      {onSend ? <ReplyBox onSend={onSend} /> : closedNote ? <Text style={styles.closed}>{closedNote}</Text> : null}
    </View>
  );
}

function Attachment({ message, base }: { message: ChatMessage; base: string }) {
  const open = useMutation({
    mutationFn: () => openFile(`${base}/${message.id}`, message.attachment_name),
  });
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${message.attachment_name}`}
        onPress={() => open.mutate()}
        style={({ hovered }: PressState) => [styles.file, hovered && styles.fileHovered]}
      >
        <Icon name="document-attach-outline" size={16} color={colors.primary} />
        <Text style={styles.fileName} numberOfLines={1}>
          {message.attachment_name}
        </Text>
      </Pressable>
      <FormError message={open.isError ? errorMessage(open.error) : null} />
    </>
  );
}

function ReplyBox({ onSend }: { onSend: (body: string, attachment: File | null) => Promise<unknown> }) {
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const send = useMutation({
    mutationFn: () => onSend(body.trim(), attachment),
    onSuccess: () => {
      setBody('');
      setAttachment(null);
    },
  });
  return (
    <View style={styles.reply}>
      <TextField
        label="Reply"
        value={body}
        onChangeText={(value) => {
          setBody(value);
          send.reset();
        }}
        placeholder="Write a message"
        multiline
        numberOfLines={3}
        maxLength={5000}
      />
      <AttachButton file={attachment} onChange={setAttachment} />
      <FormError message={send.isError ? errorMessage(send.error) : null} />
      <View style={styles.sendRow}>
        <Button
          title="Send"
          icon="send-outline"
          onPress={() => send.mutate()}
          loading={send.isPending}
          disabled={!body.trim()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { gap: space.md },
  fill: { flex: 1, minHeight: 0 },
  messages: { gap: space.md, paddingVertical: space.xs },
  message: { gap: 2, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  meta: { fontSize: font.caption, color: colors.muted },
  bubble: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm },
  bubbleMine: { backgroundColor: colors.primaryTint, borderBottomRightRadius: 2 },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 2,
  },
  body: { fontSize: font.body, color: colors.text, lineHeight: 21 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  fileHovered: { opacity: 0.85 },
  fileName: { color: colors.primary, fontWeight: weight.semibold, fontSize: font.small, flexShrink: 1 },
  reply: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
  sendRow: { alignItems: 'flex-end' },
  closed: { color: colors.muted, fontSize: font.small, textAlign: 'center', paddingVertical: space.sm },
});
