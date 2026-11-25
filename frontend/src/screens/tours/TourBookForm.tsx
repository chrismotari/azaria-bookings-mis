import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage, firstMessage } from '../../api/errors';
import { TourBooking, TourOption } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { PriceTag } from '../../components/PriceTag';
import { Stepper } from '../../components/Stepper';
import { TextField } from '../../components/TextField';
import {
  emptyTraveller,
  TravellerDraft,
  TravellerErrors,
  TravellerFields,
  travellerInput,
  travellerServerErrors,
  validateTraveller,
} from '../../components/TravellerForm';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { formatDate, formatPrice } from '../../utils/format';
import { peopleLabel, slotsLeftLabel, tourDates, unitPrice } from '../../utils/tours';

const MAX_PEOPLE = 40;

/** What the form needs of a tour: its active options and what is left. */
export type BookableTour = {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  slots_left: number;
  cancellation_policy: string;
  cancellation_deadline: string;
  options: TourOption[];
};

type Props = {
  tour: BookableTour;
  /** Whether the booker's account already has a phone; otherwise the form asks for one. */
  hasPhone: boolean;
  /** The admin books for this customer (POST /admin/tour-bookings); customers book for themselves. */
  customer?: { id: string; full_name: string };
  onBooked: (booking: TourBooking) => void;
  /** After a 409 (slots or units taken, or bookings closed), with its message: the tour is read again. */
  onConflict: (message: string) => void;
};

type Errors = { lines?: string; phone?: string; group_name?: string; notes?: string };

export function TourBookForm({ tour, hasPhone, customer, onBooked, onConflict }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [travellers, setTravellers] = useState<Record<string, TravellerDraft[]>>({});
  const [travellerErrors, setTravellerErrors] = useState<Record<string, TravellerErrors[]>>({});
  const [groupName, setGroupName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosen = tour.options.filter((option) => (quantities[option.id] ?? 0) > 0);
  const people = chosen.reduce((sum, option) => sum + option.people_per_unit * quantities[option.id], 0);
  const total = chosen.reduce((sum, option) => sum + Number(option.price) * quantities[option.id], 0);

  const setQuantity = (option: TourOption, quantity: number) => {
    setQuantities({ ...quantities, [option.id]: quantity });
    const limit = quantity * option.people_per_unit;
    if ((travellers[option.id] ?? []).length > limit) {
      setTravellers({ ...travellers, [option.id]: travellers[option.id].slice(0, limit) });
    }
  };
  const maxQuantity = (option: TourOption) => {
    const current = quantities[option.id] ?? 0;
    const others = people - current * option.people_per_unit;
    const byPeople = Math.floor((Math.min(tour.slots_left, MAX_PEOPLE) - others) / option.people_per_unit);
    return Math.max(0, Math.min(byPeople, option.units_left ?? Infinity));
  };

  const submit = async () => {
    setFormError(null);
    const found: Record<string, TravellerErrors[]> = {};
    let invalid = false;
    for (const option of chosen) {
      found[option.id] = (travellers[option.id] ?? []).map(validateTraveller);
      invalid ||= found[option.id].some((item) => Object.keys(item).length > 0);
    }
    setTravellerErrors(found);
    const missing: Errors = {};
    if (!chosen.length) {
      missing.lines = 'Choose at least one option.';
    }
    if (!hasPhone && !phone.trim()) {
      missing.phone = 'Add a phone number so the agency can reach you.';
    }
    setErrors(missing);
    if (invalid || Object.keys(missing).length) {
      setFormError(invalid ? 'Check the travellers’ details.' : (missing.lines ?? missing.phone ?? null));
      return;
    }
    setSaving(true);
    try {
      const body = {
        tour: tour.id,
        lines: chosen.map((option) => ({
          option: option.id,
          quantity: quantities[option.id],
          travellers: (travellers[option.id] ?? []).map(travellerInput),
        })),
        group_name: groupName.trim(),
        notes: notes.trim(),
        phone: phone.trim(),
        ...(customer ? { user: customer.id } : {}),
      };
      const path = customer ? '/admin/tour-bookings' : '/tour-bookings';
      const { data } = await api.post<TourBooking>(path, body);
      onBooked(data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        setFormError(errorMessage(error));
        onConflict(errorMessage(error));
        return;
      }
      const body = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      const serverTravellers: Record<string, TravellerErrors[]> = {};
      chosen.forEach((option, line) => {
        serverTravellers[option.id] = (travellers[option.id] ?? []).map(
          (_, index) => travellerServerErrors(error, ['lines', line, 'travellers', index]) ?? {},
        );
      });
      setTravellerErrors(serverTravellers);
      const fields: Errors = {};
      for (const name of ['phone', 'group_name', 'notes'] as const) {
        const message = firstMessage(body?.[name]);
        if (message) {
          fields[name] = message;
        }
      }
      const lines = body?.lines;
      if (Array.isArray(lines) && typeof lines[0] === 'string') {
        fields.lines = lines[0];
      }
      setErrors(fields);
      if (!Object.keys(fields).length) {
        const placed = Object.values(serverTravellers).some((list) => list.some((item) => Object.keys(item).length));
        setFormError(placed ? 'Check the travellers’ details.' : errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.title}>{tour.title}</Text>
        <Text style={styles.muted}>
          {tour.destination} · {tourDates(tour)}
        </Text>
        <Text style={styles.text}>{slotsLeftLabel(tour.slots_left)}</Text>
      </Card>
      <Card>
        <Text style={styles.heading}>Options</Text>
        {errors.lines ? <Text style={styles.error}>{errors.lines}</Text> : null}
        {tour.options.map((option) => {
          const quantity = quantities[option.id] ?? 0;
          const added = travellers[option.id] ?? [];
          const capacity = quantity * option.people_per_unit;
          return (
            <View key={option.id} style={styles.option}>
              <View style={styles.optionHead}>
                <View style={styles.optionText}>
                  <Text style={styles.strong}>{option.name}</Text>
                  <Text style={styles.muted}>
                    {unitPrice(option)}
                    {option.description ? ` · ${option.description}` : ''}
                    {option.units_left !== null ? ` · ${option.units_left} left` : ''}
                  </Text>
                </View>
                <Stepper
                  label={`${option.name} quantity`}
                  value={quantity}
                  min={0}
                  max={Math.max(quantity, maxQuantity(option))}
                  onChange={(next) => setQuantity(option, next)}
                  decreaseLabel={`One less ${option.name}`}
                  increaseLabel={`One more ${option.name}`}
                />
              </View>
              {quantity > 0 ? (
                <View style={styles.travellers}>
                  {added.map((draft, index) => (
                    <View key={index} style={styles.traveller}>
                      <View style={styles.between}>
                        <Text style={styles.strong}>
                          {option.name}: traveller {index + 1}
                        </Text>
                        <Button
                          title="Remove"
                          variant="link"
                          onPress={() =>
                            setTravellers({ ...travellers, [option.id]: added.filter((_, other) => other !== index) })
                          }
                        />
                      </View>
                      <TravellerFields
                        name={`${option.name} traveller ${index + 1}`}
                        value={draft}
                        onChange={(next) =>
                          setTravellers({
                            ...travellers,
                            [option.id]: added.map((item, other) => (other === index ? next : item)),
                          })
                        }
                        errors={travellerErrors[option.id]?.[index] ?? {}}
                      />
                    </View>
                  ))}
                  <View style={styles.between}>
                    <Text style={styles.muted}>
                      {added.length} of {capacity} travellers added
                    </Text>
                    {added.length < capacity ? (
                      <Button
                        title="Add traveller"
                        icon="person-add-outline"
                        variant="secondary"
                        onPress={() => setTravellers({ ...travellers, [option.id]: [...added, emptyTraveller()] })}
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.muted}>
          Traveller details are optional: you can add them now or later from the booking.
        </Text>
      </Card>
      <Card>
        <TextField
          label="Group name (optional)"
          placeholder="e.g. Otieno family"
          value={groupName}
          onChangeText={setGroupName}
          error={errors.group_name}
          maxLength={80}
        />
        {!hasPhone ? (
          <TextField
            label={customer ? `${customer.full_name}'s phone` : 'Your phone'}
            placeholder="e.g. +254 700 000 000"
            value={phone}
            onChangeText={setPhone}
            error={errors.phone}
            keyboardType="phone-pad"
            maxLength={30}
          />
        ) : null}
        <TextField
          label="Notes (optional)"
          placeholder="Anything the agency should know"
          value={notes}
          onChangeText={setNotes}
          error={errors.notes}
          multiline
          numberOfLines={3}
          maxLength={1000}
        />
      </Card>
      <Card>
        <Text style={styles.heading}>Cancellation policy</Text>
        <Text style={styles.text}>{tour.cancellation_policy}</Text>
        <Text style={styles.strong}>Free to cancel until {formatDate(tour.cancellation_deadline)}</Text>
        <View style={styles.summary}>
          {chosen.map((option) => (
            <View key={option.id} style={styles.between}>
              <Text style={styles.text}>
                {quantities[option.id]} × {option.name}
              </Text>
              <Text style={styles.text}>{formatPrice(Number(option.price) * quantities[option.id])}</Text>
            </View>
          ))}
          <View style={styles.total}>
            <View>
              <Text style={styles.heading}>Total</Text>
              <Text style={styles.muted}>{people ? peopleLabel(people) : 'Choose your options'}</Text>
            </View>
            <PriceTag amount={total} size="large" />
          </View>
        </View>
        <Text style={styles.muted}>Pay as the agency instructs; nothing is charged in the app.</Text>
        <FormError message={formError} />
        <Button title="Confirm booking" variant="accent" onPress={submit} loading={saving} />
      </Card>
    </>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted, flexShrink: 1 },
  error: { fontSize: font.small, color: colors.dangerText },
  option: { gap: space.md, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  optionText: { flexGrow: 1, flexBasis: 200, minWidth: 0, gap: 2 },
  travellers: { gap: space.md },
  traveller: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  summary: { gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.sm,
  },
}));
