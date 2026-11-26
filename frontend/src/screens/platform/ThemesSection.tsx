import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createElement, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { PlatformTheme } from '../../api/types';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { Field, FormError, inputStyle } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { Icon } from '../../components/Icon';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { ThemePreview } from '../../components/ThemePreview';
import { Card } from '../../components/Card';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';
import { contrastChecks, deriveThemeColors, HEX_COLOR, ratioLabel } from '../../utils/themeColors';
import { usePlatformThemes } from './AgencyTheme';
import { AGENCIES_KEY, THEMES_KEY } from './keys';

const COLUMNS: Column[] = [
  { label: 'Colours', flex: 1 },
  { label: 'Name', flex: 2 },
  { label: 'Agencies', flex: 1 },
  { label: 'Status', flex: 1.6 },
  { label: 'Actions', flex: 2.6 },
];

/** Platform Settings › Themes: the looks agencies choose from. Never deleted; the default is always active. */
export function ThemesSection() {
  const themes = usePlatformThemes();
  const asTable = useIsWide();
  // null: closed; 'new': a new theme; otherwise the theme being edited.
  const [editing, setEditing] = useState<PlatformTheme | 'new' | null>(null);

  return (
    <FormSection
      title="Themes"
      description="Agencies choose their look from the active themes: two colours (plus an optional bar colour and text colours), with the shades that go with them. Every theme must keep text readable. New agencies get the default theme."
    >
      <View style={styles.toolbar}>
        <Button title="New theme" icon="add" onPress={() => setEditing('new')} />
      </View>
      {themes.isPending ? (
        <LoadingState />
      ) : themes.isError ? (
        <ErrorState error={themes.error} onRetry={() => themes.refetch()} />
      ) : themes.data.length === 0 ? (
        <EmptyState icon="color-palette-outline" title="No themes" message="Add one with New theme." />
      ) : asTable ? (
        <Table columns={COLUMNS}>
          {themes.data.map((theme) => (
            <TableRow
              key={theme.id}
              columns={COLUMNS}
              cells={[
                <Swatches key="colours" theme={theme} />,
                <Text key="name" style={styles.name} numberOfLines={2}>
                  {theme.name}
                </Text>,
                <Text key="agencies" style={styles.text}>
                  {theme.agency_count}
                </Text>,
                <ThemeStatus key="status" theme={theme} />,
                <ThemeActions key="actions" theme={theme} onEdit={() => setEditing(theme)} />,
              ]}
            />
          ))}
        </Table>
      ) : (
        <View style={styles.cards}>
          {themes.data.map((theme) => (
            <Card key={theme.id}>
              <View style={styles.cardHeader}>
                <Swatches theme={theme} />
                <Text style={[styles.name, styles.shrink]} numberOfLines={2}>
                  {theme.name}
                </Text>
              </View>
              <ThemeStatus theme={theme} />
              <Text style={styles.muted}>
                {theme.agency_count} agenc{theme.agency_count === 1 ? 'y' : 'ies'}
              </Text>
              <ThemeActions theme={theme} onEdit={() => setEditing(theme)} />
            </Card>
          ))}
        </View>
      )}
      {editing ? <ThemeDialog theme={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </FormSection>
  );
}

function Swatches({ theme }: { theme: PlatformTheme }) {
  const shown = [theme.colors.primary, theme.colors.accent, ...(theme.bar ? [theme.bar] : [])];
  return (
    <View style={styles.swatches} accessibilityLabel={shown.join(', ')}>
      {shown.map((color, index) => (
        <View key={index} style={[styles.swatch, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function ThemeStatus({ theme }: { theme: PlatformTheme }) {
  return (
    <View style={styles.chips}>
      {theme.is_default ? <StatusChip label="Default" tone="info" /> : null}
      <StatusChip label={theme.is_active ? 'Active' : 'Inactive'} tone={theme.is_active ? 'success' : 'neutral'} />
    </View>
  );
}

function ThemeActions({ theme, onEdit }: { theme: PlatformTheme; onEdit: () => void }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: THEMES_KEY });
  const makeDefault = useMutation({
    mutationFn: async () => api.post(`/platform/themes/${theme.id}/make-default`),
    onSuccess: refresh,
  });
  const setActive = useMutation({
    mutationFn: async (is_active: boolean) => api.patch(`/platform/themes/${theme.id}`, { is_active }),
    onSuccess: refresh,
  });

  const onMakeDefault = async () => {
    if (
      await confirm({
        title: 'Make this the default theme?',
        message: `New agencies get ${theme.name} unless you choose another. Agencies keep the theme they have.`,
        confirmLabel: 'Make default',
        tone: 'primary',
      })
    ) {
      makeDefault.mutate();
    }
  };

  const onToggle = async () => {
    if (!theme.is_active) {
      setActive.mutate(true);
      return;
    }
    if (
      await confirm({
        title: 'Deactivate this theme?',
        message: `${theme.name} is no longer offered. ${theme.agency_count ? `The ${theme.agency_count} agenc${theme.agency_count === 1 ? 'y' : 'ies'} using it keep it until they choose another.` : 'No agency uses it.'}`,
        confirmLabel: 'Deactivate',
        tone: 'danger',
      })
    ) {
      setActive.mutate(false);
    }
  };

  const busy = makeDefault.isPending || setActive.isPending;
  const failed = makeDefault.error ?? setActive.error;
  return (
    <View style={styles.actionsBox}>
      <View style={styles.actions}>
        <Button title="Edit" variant="link" onPress={onEdit} disabled={busy} />
        {theme.is_active && !theme.is_default ? (
          <Button title="Make default" variant="link" onPress={onMakeDefault} disabled={busy} />
        ) : null}
        {!theme.is_default ? (
          <Button
            title={theme.is_active ? 'Deactivate' : 'Activate'}
            variant="link"
            onPress={onToggle}
            disabled={busy}
          />
        ) : null}
      </View>
      <FormError message={failed ? errorMessage(failed) : null} />
    </View>
  );
}

type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Shown when empty, for an optional colour. */
  placeholder?: string;
  /** The picker's colour while the field is empty: the automatic one. */
  fallback?: string;
};

/** A #rrggbb field, with the browser's colour picker beside it on web. */
function ColorField({ label, value, onChange, error, placeholder = '#rrggbb', fallback = '#000000' }: ColorFieldProps) {
  const valid = HEX_COLOR.test(value.trim());
  return (
    <Field label={label} error={error}>
      <View style={styles.colorRow}>
        <TextInput
          style={[inputStyle, styles.shrink]}
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
        />
        {Platform.OS === 'web'
          ? createElement('input', {
              type: 'color',
              'aria-label': `${label} picker`,
              value: valid ? value.trim().toLowerCase() : fallback,
              onChange: (event: { target: { value: string } }) => onChange(event.target.value),
              style: { ...pickerStyle, borderColor: colors.border },
            })
          : null}
      </View>
    </Field>
  );
}

const pickerStyle = {
  width: 48,
  height: 38,
  padding: 2,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: radius.sm,
  background: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
};

const THEME_FIELDS = ['name', 'primary', 'primary_text', 'bar', 'bar_text', 'accent', 'accent_text'] as const;
type ThemeField = (typeof THEME_FIELDS)[number];
type ColorName = Exclude<ThemeField, 'name'>;
const OPTIONAL: ColorName[] = ['primary_text', 'bar', 'bar_text', 'accent_text'];

/** Create or edit a theme: name, the two colours, the live preview and the contrast checks. */
function ThemeDialog({ theme, onClose }: { theme: PlatformTheme | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(theme?.name ?? '');
  const [values, setValues] = useState<Record<ColorName, string>>({
    primary: theme?.primary ?? '',
    primary_text: theme?.primary_text ?? '',
    bar: theme?.bar ?? '',
    bar_text: theme?.bar_text ?? '',
    accent: theme?.accent ?? '',
    accent_text: theme?.accent_text ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<ThemeField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const choice = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])) as Record<
    ColorName,
    string
  >;
  const valid = (field: ColorName) => HEX_COLOR.test(choice[field]) || (OPTIONAL.includes(field) && !choice[field]);
  const colorsValid = (Object.keys(choice) as ColorName[]).every(valid) && !(choice.bar_text && !choice.bar);
  const checks = colorsValid ? contrastChecks(choice) : [];
  const derived = colorsValid ? deriveThemeColors(choice) : null;
  const canSave = !!name.trim() && name.trim().length <= 40 && colorsValid && checks.every((check) => check.passes);

  const changeName = (value: string) => {
    setErrors((current) => ({ ...current, name: undefined }));
    setName(value);
  };
  const colorField = (field: ColorName, label: string, placeholder?: string) => (
    <ColorField
      label={label}
      value={values[field]}
      placeholder={placeholder}
      fallback={derived && OPTIONAL.includes(field) ? derived[field] : undefined}
      onChange={(value) => {
        setErrors((current) => ({ ...current, [field]: undefined }));
        setValues((current) => ({ ...current, [field]: value }));
      }}
      error={errors[field] ?? (choice[field] && !valid(field) ? 'Enter a colour as #rrggbb.' : undefined)}
    />
  );

  const onSave = async () => {
    setFormError(null);
    setSaving(true);
    const body = { name: name.trim(), ...choice };
    try {
      if (theme) {
        await api.patch(`/platform/themes/${theme.id}`, body);
      } else {
        await api.post('/platform/themes', body);
      }
      await queryClient.invalidateQueries({ queryKey: THEMES_KEY });
      // Agencies' pages show their theme's name.
      await queryClient.invalidateQueries({ queryKey: AGENCIES_KEY });
      onClose();
    } catch (error) {
      setFormError(
        applyServerErrors<Record<ThemeField, string>>(
          error,
          (field, { message }) => setErrors((current) => ({ ...current, [field]: message })),
          THEME_FIELDS,
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={theme ? 'Edit theme' : 'New theme'}
      size="large"
      onClose={onClose}
      busy={saving}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={theme ? 'Save theme' : 'Create theme'} onPress={onSave} loading={saving} disabled={!canSave} />
        </>
      }
    >
      {theme && theme.agency_count ? (
        <Text style={styles.text}>
          {theme.agency_count} agenc{theme.agency_count === 1 ? 'y uses' : 'ies use'} this theme: their site, app and
          emails take new colours the next time they load.
        </Text>
      ) : null}
      <TextField label="Name" value={name} onChangeText={changeName} maxLength={40} error={errors.name} />
      <View style={styles.pair}>
        <View style={styles.pairItem}>{colorField('primary', 'Primary')}</View>
        <View style={styles.pairItem}>{colorField('primary_text', 'Text colour on the primary', 'Automatic')}</View>
      </View>
      <Text style={styles.muted}>Links, selected states and buttons; white text on it unless you choose one.</Text>
      <View style={styles.pair}>
        <View style={styles.pairItem}>{colorField('bar', 'Bar colour (optional)', 'Same as primary')}</View>
        <View style={styles.pairItem}>{colorField('bar_text', 'Text colour on the bar', 'Automatic')}</View>
      </View>
      <Text style={styles.muted}>
        Top bar, Explore's heading cards and the sign-in panel. Use it for a light brand colour; the text turns dark on
        it automatically.
      </Text>
      {choice.bar_text && !choice.bar ? (
        <Text style={styles.failingText}>Choose a bar colour for this text colour.</Text>
      ) : null}
      <View style={styles.pair}>
        <View style={styles.pairItem}>{colorField('accent', 'Accent')}</View>
        <View style={styles.pairItem}>{colorField('accent_text', 'Text colour on the accent', 'Automatic')}</View>
      </View>
      <Text style={styles.muted}>Prices and main calls to action; dark text on it unless you choose one.</Text>
      {colorsValid ? (
        <>
          <Text style={styles.subheading}>Preview</Text>
          <ThemePreview theme={derived ?? deriveThemeColors(choice)} />
          <Text style={styles.subheading}>Contrast</Text>
          <View style={styles.checks}>
            {checks.map((check) => (
              <View key={check.label} style={styles.check}>
                <Icon
                  name={check.passes ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={check.passes ? colors.successText : colors.dangerText}
                  label={check.passes ? 'Passes' : 'Fails'}
                />
                <Text style={[styles.text, styles.shrink]}>{check.label}</Text>
                <Text style={[styles.ratio, !check.passes && styles.failing]}>
                  {ratioLabel(check.ratio)} (needs {check.min}:1)
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={styles.muted}>Enter the primary and the accent to see the preview and the contrast checks.</Text>
      )}
    </Dialog>
  );
}

const styles = createStyles(() => ({
  toolbar: { alignItems: 'flex-start' },
  cards: { gap: space.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  subheading: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, marginTop: space.xs },
  shrink: { flex: 1, minWidth: 0 },
  swatches: { flexDirection: 'row', gap: space.xs },
  swatch: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actionsBox: { gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
  colorRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  checks: { gap: space.xs },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ratio: { fontSize: font.body, fontWeight: weight.semibold, color: colors.successText, fontVariant: ['tabular-nums'] },
  failing: { color: colors.dangerText },
  failingText: { fontSize: font.small, color: colors.dangerText },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  pairItem: { flexGrow: 1, flexBasis: 200, minWidth: 0 },
}));
