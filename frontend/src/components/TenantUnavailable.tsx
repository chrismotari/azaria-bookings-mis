import { StyleSheet, Text, View } from 'react-native';

import { switchAgency } from '../agency/agency';
import { IS_NATIVE } from '../config';
import { colors, font, space, weight } from '../theme';
import { Button } from './Button';
import { Card } from './Card';
import { EmptyState } from './StatusViews';

/** Replaces the whole app when this address has no agency or the agency is suspended. */
export function TenantUnavailable({ message }: { message: string }) {
  return (
    <View style={styles.page}>
      <View style={styles.bar}>
        <Text style={styles.brand}>Azaria Bookings</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.box}>
          <Card>
            <EmptyState icon="business-outline" title="Agency not available" message={message} />
            {/* Native: the shared app can move on to another agency. */}
            {IS_NATIVE ? <Button title="Switch agency" variant="secondary" onPress={() => void switchAgency()} /> : null}
          </Card>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.primary, paddingHorizontal: space.lg, paddingVertical: space.md },
  brand: { color: colors.primaryText, fontSize: font.heading, fontWeight: weight.heavy },
  body: { flex: 1, padding: space.lg, alignItems: 'center', justifyContent: 'center' },
  box: { width: '100%', maxWidth: 520 },
});
