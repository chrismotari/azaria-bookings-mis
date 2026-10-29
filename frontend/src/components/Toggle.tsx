import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors } from '../theme';

type Props = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

export function Toggle({ label, value, onChange, disabled }: Props) {
  return (
    <View style={styles.row}>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 14, color: colors.text },
});
