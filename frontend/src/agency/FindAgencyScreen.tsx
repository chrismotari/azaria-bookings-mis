import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { AgencyInfo } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { FormError } from '../components/Field';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { colors, font, radius, space, weight } from '../theme';
import { AGENCY_CODE, chooseAgency, findAgency } from './agency';

const schema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(AGENCY_CODE, 'Agency codes are 3 to 30 letters, digits and hyphens, starting with a letter.'),
});

type FormValues = z.input<typeof schema>;

/** Native, with no agency stored: the agency's code, checked, then confirmed. */
export function FindAgencyScreen() {
  const insets = useSafeAreaInsets();
  const [found, setFound] = useState<AgencyInfo | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      setFound(await findAgency(code));
    } catch (error) {
      setFormError((error as Error).message);
    }
  });

  const onContinue = async () => {
    if (found) {
      setContinuing(true);
      await chooseAgency(found);
    }
  };

  return (
    <View style={styles.page}>
      <View style={[styles.bar, { paddingTop: insets.top + space.md }]}>
        <Text style={styles.brand}>Azaria Bookings</Text>
      </View>
      <Screen maxWidth={440}>
        <Card>
          <Text style={styles.title}>Find your agency</Text>
          {found ? (
            <>
              <View style={styles.agency}>
                <View style={styles.agencyIcon}>
                  <Icon name="business-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.agencyText}>
                  <Text style={styles.agencyName}>{found.name}</Text>
                  <Text style={styles.agencyCode}>Code: {found.code}</Text>
                </View>
              </View>
              <Button title="Continue" variant="accent" loading={continuing} onPress={onContinue} />
              <Button
                title="Not your agency? Enter another code"
                variant="link"
                disabled={continuing}
                onPress={() => setFound(null)}
              />
            </>
          ) : (
            <>
              <Text style={styles.help}>Enter the agency code your travel agency gave you.</Text>
              <Controller
                control={control}
                name="code"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Agency code"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={() => onSubmit()}
                  />
                )}
              />
              <FormError message={formError} />
              <Button title="Find agency" loading={formState.isSubmitting} onPress={onSubmit} />
            </>
          )}
        </Card>
        <Text style={styles.hint}>Got an email from your agency? Tap its link.</Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.primary, paddingHorizontal: space.lg, paddingBottom: space.md },
  brand: { color: colors.primaryText, fontSize: font.heading, fontWeight: weight.heavy },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  help: { fontSize: font.body, color: colors.muted },
  agency: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  agencyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agencyText: { flexShrink: 1, gap: 2 },
  agencyName: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  agencyCode: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.body, color: colors.muted, textAlign: 'center' },
});
