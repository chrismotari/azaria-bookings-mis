import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { api } from '../api/client';
import { Itinerary, Traveller, TravellerInput } from '../api/types';
import { colors, createStyles, font, radius, space, weight } from '../theme';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import {
  emptyTraveller,
  TravellerDialog,
  TravellerDraft,
  travellerDraft,
  TravellerErrors,
  TravellerFields,
  TravellerSummary,
} from './TravellerForm';

/** The date of the itinerary's last flight (YYYY-MM-DD). */
export function lastFlightDate(itinerary: Itinerary): string {
  const segments = [...itinerary.outbound.segments, ...(itinerary.return?.segments ?? [])];
  return segments.reduce((last, segment) => (segment.departure_date > last ? segment.departure_date : last), '');
}

/** The drafts grown or shrunk to count, keeping what was typed. */
export function resizePassengers(drafts: TravellerDraft[], count: number): TravellerDraft[] {
  return drafts.length >= count
    ? drafts.slice(0, count)
    : [...drafts, ...Array.from({ length: count - drafts.length }, emptyTraveller)];
}

type FormsProps = {
  drafts: TravellerDraft[];
  onChange: (drafts: TravellerDraft[]) => void;
  errors: TravellerErrors[];
};

/** One passenger form per passenger, with the required fields marked. */
export function PassengerForms({ drafts, onChange, errors }: FormsProps) {
  return (
    <View style={styles.forms}>
      <Text style={styles.muted}>
        Enter each passenger as on their travel document; the airline needs these details. * Required
      </Text>
      {drafts.map((draft, index) => (
        <View key={index} style={styles.form}>
          <Text style={styles.strong}>Passenger {index + 1}</Text>
          <TravellerFields
            passenger
            name={`Passenger ${index + 1}`}
            value={draft}
            onChange={(next) => onChange(drafts.map((item, other) => (other === index ? next : item)))}
            errors={errors[index] ?? {}}
          />
        </View>
      ))}
    </View>
  );
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2030-01-17" as "17JAN2030". */
function gdsDate(value: string | null): string {
  if (!value) {
    return '';
  }
  const [year, month, day] = value.split('-');
  return `${day}${MONTHS[Number(month) - 1]}${year}`;
}

/** Each passenger as "SURNAME/GIVEN NAMES, gender, date of birth, document, expiry, nationality". */
export function gdsLines(travellers: Traveller[]): string {
  return travellers
    .map((traveller) => {
      const names = traveller.full_name.trim().toUpperCase().split(/\s+/);
      const surname = names.pop() ?? '';
      return [
        names.length ? `${surname}/${names.join(' ')}` : surname,
        traveller.gender === 'female' ? 'F' : traveller.gender === 'male' ? 'M' : '',
        gdsDate(traveller.date_of_birth),
        traveller.document_number
          ? `${traveller.document_type === 'passport' ? 'PASSPORT' : 'NATIONAL ID'} ${traveller.document_number}`
          : '',
        gdsDate(traveller.document_expiry),
        traveller.nationality,
      ].join(', ');
    })
    .join('\n');
}

type CardProps = {
  booking: { id: string; itinerary: Itinerary; travellers: Traveller[]; can_edit_travellers: boolean };
  /** The booking's API path, e.g. "/bookings/<id>" or "/admin/bookings/<id>". */
  base: string;
  queryKey: readonly unknown[];
  /** Admins see documents in full and can copy the passengers for the GDS; customers see numbers masked. */
  admin?: boolean;
};

/** The booking's passengers, each editable with the shared form while can_edit_travellers. */
export function PassengersCard({ booking, base, queryKey, admin }: CardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Traveller | null>(null);
  const [copied, setCopied] = useState(false);
  const canCopy = admin && Platform.OS === 'web' && booking.travellers.length > 0;

  const save = async (input: TravellerInput) => {
    if (editing) {
      await api.patch(`${base}/travellers/${editing.id}`, input);
      await queryClient.invalidateQueries({ queryKey });
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(gdsLines(booking.travellers));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <View style={styles.between}>
        <Text style={styles.section}>Passengers</Text>
        {canCopy ? (
          <Button
            title={copied ? 'Copied' : 'Copy for GDS'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            variant="secondary"
            onPress={copy}
          />
        ) : null}
      </View>
      {booking.travellers.length === 0 ? <Text style={styles.muted}>No passenger details recorded</Text> : null}
      {booking.travellers.map((traveller) => (
        <View key={traveller.id} style={styles.passenger}>
          <Icon name="person-outline" size={18} color={colors.muted} />
          <TravellerSummary traveller={traveller} masked={!admin} />
          {booking.can_edit_travellers ? (
            <View style={styles.edit}>
              <Button title="Edit" variant="link" onPress={() => setEditing(traveller)} />
            </View>
          ) : null}
        </View>
      ))}
      {editing ? (
        <TravellerDialog
          title="Edit passenger"
          initial={travellerDraft(editing)}
          onSave={save}
          onClose={() => setEditing(null)}
          passenger={{ lastFlightDate: lastFlightDate(booking.itinerary) }}
        />
      ) : null}
    </Card>
  );
}

const styles = createStyles(() => ({
  forms: { gap: space.md },
  form: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  passenger: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  edit: { marginLeft: 'auto' },
}));
