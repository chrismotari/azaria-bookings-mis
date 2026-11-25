import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage, firstMessage } from '../../api/errors';
import { Hotel, HotelBooking, HotelRate, HotelRoomType } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { FieldGrid, FormError } from '../../components/Field';
import { PriceTag } from '../../components/PriceTag';
import { SelectField } from '../../components/SelectField';
import { TextField } from '../../components/TextField';
import {
  emptyTraveller,
  passengerFrom,
  TravellerDraft,
  TravellerErrors,
  TravellerFields,
  travellerInput,
  travellerServerErrors,
  validateTraveller,
} from '../../components/TravellerForm';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { formatPrice } from '../../utils/format';
import { adultsPriced, MAX_ROOMS, nightsLabel, roomStayPrice } from '../../utils/hotels';
import { Stay, StayErrors, validateStay } from './HotelParts';

type RoomDraft = { key: number; rate: string; adults: number; children: number; guests: TravellerDraft[] };

type Props = {
  /** The hotel priced for the stay (fetched with its dates). */
  hotel: Hotel;
  stay: Stay;
  /** The dates changed here: the page fetches the hotel again for them. */
  onStayChange: (stay: Stay) => void;
  /** Rate ids picked on the hotel page, one per room. */
  initialRates: string[];
  /** The booker: prefills the first room's lead guest. */
  contact: { full_name: string; email: string; phone: string };
  hasPhone: boolean;
  /** The admin books for this customer (POST /admin/hotel-bookings); customers book for themselves. */
  customer?: { id: string; full_name: string };
  onBooked: (booking: HotelBooking) => void;
  /** After a 409 (a room no longer offered), with its message: the hotel is read again. */
  onConflict: (message: string) => void;
};

type Errors = { rooms?: string; phone?: string; special_requests?: string; notes?: string };

let nextKey = 0;

function rateIndex(hotel: Hotel): Record<string, { roomType: HotelRoomType; rate: HotelRate }> {
  return Object.fromEntries(
    hotel.room_types.flatMap((roomType) => roomType.rates.map((rate) => [rate.id, { roomType, rate }])),
  );
}

export function HotelBookForm({
  hotel,
  stay,
  onStayChange,
  initialRates,
  contact,
  hasPhone,
  customer,
  onBooked,
  onConflict,
}: Props) {
  const rates = rateIndex(hotel);
  const firstRate = hotel.room_types[0]?.rates[0]?.id ?? '';
  const adults = stay.adults ? Number(stay.adults) : undefined;
  const children = Number(stay.children || 0);
  const newRoom = (rate: string, lead: TravellerDraft): RoomDraft => {
    const found = rates[rate]?.rate;
    return {
      key: nextKey++,
      rate,
      adults: found ? adultsPriced(found, adults) : 1,
      children: found ? Math.min(children, found.max_children) : 0,
      guests: [lead],
    };
  };
  const [rooms, setRooms] = useState<RoomDraft[]>(() => {
    const picked = initialRates.filter((rate) => rates[rate]);
    return (picked.length ? picked : [firstRate]).map((rate, index) =>
      newRoom(rate, index === 0 ? passengerFrom(contact) : emptyTraveller()),
    );
  });
  const [guestErrors, setGuestErrors] = useState<Record<number, TravellerErrors[]>>({});
  const [dates, setDates] = useState<Stay>(stay);
  const [stayErrors, setStayErrors] = useState<StayErrors>({});
  const [phone, setPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [roomErrors, setRoomErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (index: number, changes: Partial<RoomDraft>) =>
    setRooms(rooms.map((room, other) => (other === index ? { ...room, ...changes } : room)));
  const setOccupancy = (index: number, adultsCount: number, childrenCount: number) =>
    update(index, {
      adults: adultsCount,
      children: childrenCount,
      guests: rooms[index].guests.slice(0, adultsCount + childrenCount),
    });
  const priceOf = (room: RoomDraft) => {
    const found = rates[room.rate]?.rate;
    return found ? roomStayPrice(found, room.adults) : null;
  };
  const total = rooms.reduce((sum, room) => sum + (priceOf(room) ?? 0), 0);
  const nights = Object.values(rates).find(({ rate }) => rate.nights)?.rate.nights ?? 0;

  const changeDates = (next: Stay) => {
    setDates(next);
    setStayErrors(validateStay(next));
    if (next.check_in && next.check_out && Object.keys(validateStay(next)).length === 0) {
      onStayChange(next);
    }
  };

  const chooseRate = (index: number, rate: string) => {
    const found = rates[rate]?.rate;
    const room = rooms[index];
    if (!found) {
      return;
    }
    const nextAdults = Math.min(room.adults, found.max_adults);
    const nextChildren = Math.min(room.children, found.max_children);
    update(index, {
      rate,
      adults: nextAdults,
      children: nextChildren,
      guests: room.guests.slice(0, Math.max(1, nextAdults + nextChildren)),
    });
  };

  const submit = async () => {
    setFormError(null);
    const foundStay = validateStay(dates);
    const missingDates = !dates.check_in || !dates.check_out;
    setStayErrors(missingDates ? { check_in: 'Choose the dates of the stay.' } : foundStay);
    const found: Record<number, TravellerErrors[]> = {};
    let invalid = false;
    rooms.forEach((room, index) => {
      found[index] = room.guests.map(validateTraveller);
      invalid ||= found[index].some((item) => Object.keys(item).length > 0);
    });
    setGuestErrors(found);
    const unavailable = Object.fromEntries(
      rooms.flatMap((room, index) => (priceOf(room) === null ? [[index, 'Not available for these dates.']] : [])),
    );
    setRoomErrors(unavailable);
    const missing: Errors = {};
    if (!hasPhone && !phone.trim()) {
      missing.phone = 'Add a phone number so the agency can reach you.';
    }
    setErrors(missing);
    if (missingDates || Object.keys(foundStay).length) {
      setFormError('Choose the dates of the stay.');
      return;
    }
    if (invalid || Object.keys(unavailable).length || Object.keys(missing).length) {
      setFormError(
        invalid
          ? 'Check the guests’ details.'
          : Object.keys(unavailable).length
            ? 'Choose a room that is available for these dates.'
            : (missing.phone ?? null),
      );
      return;
    }
    setSaving(true);
    try {
      const body = {
        hotel: hotel.id,
        check_in: dates.check_in,
        check_out: dates.check_out,
        rooms: rooms.map((room) => ({
          room_type: rates[room.rate].roomType.id,
          rate: room.rate,
          adults: room.adults,
          children: room.children,
          guests: room.guests.map(travellerInput),
        })),
        special_requests: specialRequests.trim(),
        notes: notes.trim(),
        phone: phone.trim(),
        ...(customer ? { user: customer.id } : {}),
      };
      const path = customer ? '/admin/hotel-bookings' : '/hotel-bookings';
      const { data } = await api.post<HotelBooking>(path, body);
      onBooked(data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        setFormError(errorMessage(error));
        onConflict(errorMessage(error));
        return;
      }
      const response = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      const serverGuests: Record<number, TravellerErrors[]> = {};
      const serverRooms: Record<number, string> = {};
      rooms.forEach((room, index) => {
        serverGuests[index] = room.guests.map(
          (_, guest) => travellerServerErrors(error, ['rooms', index, 'guests', guest]) ?? {},
        );
        const roomBody = (response?.rooms as Record<number, Record<string, unknown>> | undefined)?.[index];
        const message =
          roomBody && typeof roomBody === 'object' && !Array.isArray(roomBody)
            ? (firstMessage(roomBody.adults) ?? firstMessage(roomBody.rate) ?? firstMessage(roomBody.guests))
            : null;
        if (message) {
          serverRooms[index] = message;
        }
      });
      setGuestErrors(serverGuests);
      setRoomErrors(serverRooms);
      const fields: Errors = {};
      for (const name of ['phone', 'special_requests', 'notes', 'rooms'] as const) {
        const message = firstMessage(response?.[name]);
        if (message) {
          fields[name] = message;
        }
      }
      setErrors(fields);
      const placed =
        Object.keys(serverRooms).length ||
        Object.values(serverGuests).some((list) => list.some((item) => Object.keys(item).length));
      setFormError(placed || Object.keys(fields).length ? 'Check the highlighted details.' : errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.title}>{hotel.name}</Text>
        <Text style={styles.muted}>
          {hotel.address}, {hotel.destination}
        </Text>
        <FieldGrid columns={2}>
          <DateField
            label="Check-in"
            value={dates.check_in}
            onChange={(check_in) => changeDates({ ...dates, check_in })}
            error={stayErrors.check_in}
          />
          <DateField
            label="Check-out"
            value={dates.check_out}
            onChange={(check_out) => changeDates({ ...dates, check_out })}
            error={stayErrors.check_out}
          />
        </FieldGrid>
        {nights ? <Text style={styles.text}>{nightsLabel(nights)}</Text> : null}
      </Card>

      {rooms.map((room, index) => {
        const found = rates[room.rate];
        const price = priceOf(room);
        const capacity = room.adults + room.children;
        return (
          <Card key={room.key}>
            <View style={styles.between}>
              <Text style={styles.heading}>Room {index + 1}</Text>
              {rooms.length > 1 ? (
                <Button
                  title="Remove room"
                  variant="link"
                  onPress={() => setRooms(rooms.filter((_, other) => other !== index))}
                />
              ) : null}
            </View>
            <FieldGrid columns={2}>
              <SelectField
                label="Room type"
                accessibilityLabel={`Room ${index + 1} type`}
                options={hotel.room_types.map((roomType) => ({ value: roomType.id, label: roomType.name }))}
                value={found?.roomType.id ?? ''}
                onChange={(roomType) =>
                  chooseRate(index, hotel.room_types.find((item) => item.id === roomType)?.rates[0]?.id ?? '')
                }
              />
              <SelectField
                label="Rate"
                accessibilityLabel={`Room ${index + 1} rate`}
                options={(found?.roomType.rates ?? []).map((rate) => ({ value: rate.id, label: rate.name }))}
                value={room.rate}
                onChange={(rate) => chooseRate(index, rate)}
              />
              <SelectField
                label="Adults"
                accessibilityLabel={`Room ${index + 1} adults`}
                options={Array.from({ length: found?.rate.max_adults ?? 1 }, (_, at) => ({
                  value: String(at + 1),
                  label: String(at + 1),
                }))}
                value={String(room.adults)}
                onChange={(value) => setOccupancy(index, Number(value), room.children)}
              />
              <SelectField
                label="Children"
                accessibilityLabel={`Room ${index + 1} children`}
                options={Array.from({ length: (found?.rate.max_children ?? 0) + 1 }, (_, at) => ({
                  value: String(at),
                  label: String(at),
                }))}
                value={String(room.children)}
                onChange={(value) => setOccupancy(index, room.adults, Number(value))}
              />
            </FieldGrid>
            {found?.rate.inclusions.length ? (
              <Text style={styles.muted}>{found.rate.inclusions.join(' · ')}</Text>
            ) : null}
            <View style={styles.between}>
              <Text style={styles.muted}>
                {price === null
                  ? dates.check_in
                    ? 'Not available for these dates'
                    : 'Choose dates to see the price'
                  : Number(found?.rate.per_adult_per_night) > 0
                    ? `Includes ${formatPrice(found.rate.per_adult_per_night)} per adult per night`
                    : ''}
              </Text>
              {price !== null ? <Text style={styles.strong}>{formatPrice(price)}</Text> : null}
            </View>
            <FormError message={roomErrors[index]} />
            {room.guests.map((guest, guestIndex) => (
              <View key={guestIndex} style={styles.guest}>
                <View style={styles.between}>
                  <Text style={styles.strong}>{guestIndex === 0 ? 'Lead guest' : `Guest ${guestIndex + 1}`}</Text>
                  {guestIndex > 0 ? (
                    <Button
                      title="Remove"
                      variant="link"
                      onPress={() => update(index, { guests: room.guests.filter((_, other) => other !== guestIndex) })}
                    />
                  ) : null}
                </View>
                <TravellerFields
                  name={`Room ${index + 1} ${guestIndex === 0 ? 'lead guest' : `guest ${guestIndex + 1}`}`}
                  value={guest}
                  onChange={(next) =>
                    update(index, { guests: room.guests.map((item, other) => (other === guestIndex ? next : item)) })
                  }
                  errors={guestErrors[index]?.[guestIndex] ?? {}}
                />
              </View>
            ))}
            <View style={styles.between}>
              <Text style={styles.muted}>
                {room.guests.length} of {capacity} guests added
              </Text>
              {room.guests.length < capacity ? (
                <Button
                  title="Add guest"
                  icon="person-add-outline"
                  variant="secondary"
                  onPress={() => update(index, { guests: [...room.guests, emptyTraveller()] })}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
      <FormError message={errors.rooms} />
      {rooms.length < MAX_ROOMS && firstRate ? (
        <View style={styles.start}>
          <Button
            title="Add room"
            icon="add"
            variant="secondary"
            onPress={() => setRooms([...rooms, newRoom(rooms[rooms.length - 1]?.rate ?? firstRate, emptyTraveller())])}
          />
        </View>
      ) : null}

      <Card>
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
          label="Special requests (optional, passed to the hotel)"
          placeholder="e.g. A quiet room, late arrival"
          value={specialRequests}
          onChangeText={setSpecialRequests}
          error={errors.special_requests}
          multiline
          numberOfLines={3}
          maxLength={1000}
        />
        <TextField
          label="Notes for the agency (optional)"
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
        <Text style={styles.text}>{hotel.cancellation_policy}</Text>
        <View style={styles.summary}>
          <View style={styles.total}>
            <View>
              <Text style={styles.heading}>Total</Text>
              <Text style={styles.muted}>
                {rooms.length} room{rooms.length === 1 ? '' : 's'}
                {nights ? `, ${nightsLabel(nights)}` : ''}
              </Text>
            </View>
            <PriceTag amount={total} size="large" />
          </View>
        </View>
        <Text style={styles.muted}>
          The agency will confirm availability with the hotel. Pay only once it does, as the agency instructs.
        </Text>
        <FormError message={formError} />
        <Button title="Request booking" variant="accent" onPress={submit} loading={saving} />
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
  start: { alignSelf: 'flex-start' },
  guest: {
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
