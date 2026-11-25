import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MODULE_LABELS } from '../../agency/modules';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Module, TenantDetail } from '../../api/types';
import { Card } from '../../components/Card';
import { Field, FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { Toggle } from '../../components/Toggle';
import { colors, createStyles, font, space, weight } from '../../theme';

export const MODULES: Module[] = ['flights', 'tours', 'hotels'];

/** The modules in the API's order, with one switched on or off. */
function withModule(modules: Module[], module: Module, on: boolean): Module[] {
  return MODULES.filter((item) => (item === module ? on : modules.includes(item)));
}

/** The agencies table's column: e.g. "Flights, Tours". */
export function modulesLabel(modules: Module[]): string {
  return modules.map((module) => MODULE_LABELS[module]).join(', ');
}

type CheckboxProps = { value: Module[]; onChange: (value: Module[]) => void; error?: string };

/** The New agency dialog's Modules checkboxes. */
export function ModuleCheckboxes({ value, onChange, error }: CheckboxProps) {
  return (
    <Field label="Modules" error={error}>
      <View style={styles.checkboxes}>
        {MODULES.map((module) => {
          const checked = value.includes(module);
          return (
            <Pressable
              key={module}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => onChange(withModule(value, module, !checked))}
              style={({ hovered }: PressState) => [styles.checkbox, hovered && styles.hovered]}
            >
              <Icon name={checked ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <Text style={styles.text}>{MODULE_LABELS[module]}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/** Platform › an agency: a switch per module, each saved at once. */
export function AgencyModules({ tenant, onSaved }: { tenant: TenantDetail; onSaved: (data: TenantDetail) => unknown }) {
  const [saving, setSaving] = useState<Module | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (module: Module, on: boolean) => {
    setError(null);
    setSaving(module);
    try {
      const modules = withModule(tenant.modules, module, on);
      const { data } = await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, { modules });
      await onSaved(data);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <Text style={styles.section}>Modules</Text>
      <Text style={styles.muted}>What the agency has bought. Whatever belongs to a module that is off is hidden.</Text>
      {MODULES.map((module) => (
        <Toggle
          key={module}
          label={MODULE_LABELS[module]}
          value={tenant.modules.includes(module)}
          onChange={(on) => void change(module, on)}
          disabled={saving !== null}
        />
      ))}
      <FormError message={error} />
    </Card>
  );
}

const styles = createStyles(() => ({
  checkboxes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs, borderRadius: 4 },
  hovered: { opacity: 0.8 },
  text: { fontSize: font.body, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  muted: { color: colors.muted },
}));
