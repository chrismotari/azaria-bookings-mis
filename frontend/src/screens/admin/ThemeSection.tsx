import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { themeSaved } from '../../agency/agency';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AgencyInfo, AppSettings, Theme } from '../../api/types';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { SelectField } from '../../components/SelectField';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { ThemePreview } from '../../components/ThemePreview';
import { createStyles, space } from '../../theme';

/** Agency Settings › Theme: choose one of the active themes; the admin's own app takes it at once. */
export function ThemeSection({ current, settingsKey }: { current: string; settingsKey: string[] }) {
  const queryClient = useQueryClient();
  const themes = useQuery({
    queryKey: ['admin', 'themes'],
    queryFn: async () => (await api.get<Theme[]>('/admin/themes')).data,
  });
  // The agency's name for the preview, and its theme even when that one is no longer offered.
  const agency = useQuery({
    queryKey: ['agency'],
    queryFn: async () => (await api.get<AgencyInfo>('/agency')).data,
  });
  const [selected, setSelected] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const description =
    'Your site, app and emails use its colours. Customers see a new theme the next time they open the app.';
  if (themes.isPending || agency.isPending) {
    return (
      <FormSection title="Theme" description={description}>
        <LoadingState />
      </FormSection>
    );
  }
  if (themes.isError || agency.isError) {
    const failed = themes.isError ? themes : agency;
    return (
      <FormSection title="Theme" description={description}>
        <ErrorState error={failed.error} onRetry={() => failed.refetch()} />
      </FormSection>
    );
  }
  // An agency keeps a theme the owner has since deactivated until it chooses another.
  const options = themes.data.some((theme) => theme.id === agency.data.theme.id)
    ? themes.data
    : [...themes.data, agency.data.theme];
  const chosen = options.find((theme) => theme.id === selected) ?? agency.data.theme;

  const onSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const { data } = await api.patch<AppSettings>('/admin/settings', { theme: chosen.id });
      queryClient.setQueryData(settingsKey, data);
      await queryClient.invalidateQueries({ queryKey: ['agency'] });
      await themeSaved(chosen.colors);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Theme" description={description}>
      <SelectField
        label="Theme"
        options={options.map((theme) => ({ value: theme.id, label: theme.name }))}
        value={chosen.id}
        onChange={setSelected}
      />
      <ThemePreview theme={chosen.colors} name={agency.data.name} />
      <FormError message={error} />
      <View style={styles.actions}>
        <Button title="Save theme" onPress={onSave} loading={saving} disabled={chosen.id === current} />
      </View>
    </FormSection>
  );
}

const styles = createStyles(() => ({
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md },
}));
