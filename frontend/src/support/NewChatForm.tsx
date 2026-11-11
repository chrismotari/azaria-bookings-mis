import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { errorMessage, firstMessage } from '../api/errors';
import { ChatDetail } from '../api/types';
import { Button } from '../components/Button';
import { FormError } from '../components/Field';
import { TextField } from '../components/TextField';
import { colors, font, space } from '../theme';
import { AttachButton } from './AttachButton';
import { messageBody } from './api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  /** The signed-in user's email (editable), or blank for a guest. */
  email: string;
  subject?: string;
  message?: string;
  /** The API path chats are started on. */
  path?: string;
  /** A signed-in requester gets the new chat; a guest gets null (their chat cannot be read back). */
  onSent: (chat: ChatDetail | null, email: string) => void;
};

type Errors = Partial<Record<'email' | 'subject' | 'body' | 'attachment', string>>;

export function NewChatForm({
  email: initialEmail,
  subject: initialSubject = '',
  message = '',
  path = '/support/chats',
  onSent,
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(message);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const send = useMutation({
    mutationFn: async () => {
      const response = await api.post<ChatDetail | { email: string }>(
        path,
        messageBody({ email: email.trim(), subject: subject.trim(), body: body.trim() }, attachment),
      );
      return response.data;
    },
    onSuccess: (data) => onSent('id' in data ? data : null, email.trim()),
    onError: (error) => {
      const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data ?? {};
      setErrors({
        email: firstMessage(data.email) ?? undefined,
        subject: firstMessage(data.subject) ?? undefined,
        body: firstMessage(data.body) ?? undefined,
        attachment: firstMessage(data.attachment) ?? undefined,
      });
    },
  });

  const submit = () => {
    const found: Errors = {};
    if (!EMAIL.test(email.trim())) found.email = 'Enter a valid email address.';
    if (!subject.trim()) found.subject = 'Enter a subject.';
    if (!body.trim()) found.body = 'Write a message.';
    setErrors(found);
    if (Object.keys(found).length === 0) {
      send.mutate();
    }
  };
  const fieldErrors = Object.values(errors).some(Boolean);

  return (
    <View style={styles.form}>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <TextField label="Subject" value={subject} onChangeText={setSubject} error={errors.subject} maxLength={150} />
      <TextField
        label="Message"
        value={body}
        onChangeText={setBody}
        error={errors.body}
        multiline
        numberOfLines={5}
        maxLength={5000}
      />
      <AttachButton file={attachment} onChange={setAttachment} />
      {errors.attachment ? <Text style={styles.error}>{errors.attachment}</Text> : null}
      <FormError message={send.isError && !fieldErrors ? errorMessage(send.error) : null} />
      <Button title="Send" icon="send-outline" onPress={submit} loading={send.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md },
  error: { color: colors.dangerText, fontSize: font.small },
});
