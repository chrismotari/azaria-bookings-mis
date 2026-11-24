import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { PlatformTheme, TenantDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { SelectField } from '../../components/SelectField';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { ThemePreview } from '../../components/ThemePreview';
import { colors, createStyles, space, weight } from '../../theme';
import { THEMES_KEY } from './keys';

export function usePlatformThemes() {
  return useQuery({
    queryKey: THEMES_KEY,
    queryFn: async () => (await api.get<PlatformTheme[]>('/platform/themes')).data,
  });
}

/** What an agency may choose: the active themes, and the one it already has. */
export function themeChoices(themes: PlatformTheme[], current?: string): PlatformTheme[] {
  return themes.filter((theme) => theme.is_active || theme.id === current);
}

type PickerProps = {
  themes: PlatformTheme[];
  value: string;
  onChange: (id: string) => void;
  /** For the preview's top bar. */
  name?: string;
};

/** A theme dropdown with the preview of the chosen theme. */
export function ThemePicker({ themes, value, onChange, name }: PickerProps) {
  const chosen = themes.find((theme) => theme.id === value);
  return (
    <>
      <SelectField
        label="Theme"
        options={themes.map((theme) => ({ value: theme.id, label: theme.name }))}
        value={value}
        onChange={onChange}
      />
      {chosen ? <ThemePreview theme={chosen.colors} name={name} /> : null}
    </>
  );
}

/** Platform › Agencies › an agency: its theme, which the owner can change. */
export function AgencyTheme({ tenant, onSaved }: { tenant: TenantDetail; onSaved: (data: TenantDetail) => unknown }) {
  const themes = usePlatformThemes();
  const [selected, setSelected] = useState(tenant.theme);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (themes.isPending) {
    return <LoadingState />;
  }
  if (themes.isError) {
    return <ErrorState error={themes.error} onRetry={() => themes.refetch()} />;
  }

  const onSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const { data } = await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, { theme: selected });
      setSaved(true);
      await onSaved(data);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.box}>
      <ThemePicker
        themes={themeChoices(themes.data, tenant.theme)}
        value={selected}
        onChange={(id) => {
          setSaved(false);
          setSelected(id);
        }}
        name={tenant.name}
      />
      <FormError message={error} />
      <View style={styles.actions}>
        {saved && selected === tenant.theme ? <Text style={styles.saved}>Theme saved.</Text> : null}
        <Button
          title="Save theme"
          variant="secondary"
          onPress={onSave}
          loading={saving}
          disabled={selected === tenant.theme}
        />
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  box: { gap: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.md },
  saved: { color: colors.successText, fontWeight: weight.semibold },
}));
