import { z } from 'zod';

import { Airline, Airport, Direction, Itinerary, Policy, Segment, TicketClass, TripType } from '../../api/types';
import { todayInNairobi } from '../../utils/format';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const dateString = (message: string) =>
  z
    .string()
    .regex(DATE, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), message);

/** The most flights per direction, so at most 4 connections (the server's rule too). */
export const MAX_FLIGHTS = 5;

export type SegmentFormValues = {
  airline: Airline | null;
  flight_number: string;
  operating_airline: Airline | null;
  origin: Airport | null;
  destination: Airport | null;
  departure_date: string;
  departure_time: string;
  arrival_date: string;
  arrival_time: string;
};

export type ItineraryFormValues = Record<Direction, SegmentFormValues[]>;

/** A blank flight, with what is already known prefilled. */
export function newSegment(values: Partial<SegmentFormValues> = {}): SegmentFormValues {
  return {
    airline: null,
    flight_number: '',
    operating_airline: null,
    origin: null,
    destination: null,
    departure_date: '',
    departure_time: '',
    arrival_date: '',
    arrival_time: '',
    ...values,
  };
}

function toSegmentForm(segment: Segment): SegmentFormValues {
  return { ...segment };
}

export function toItineraryFormValues(itinerary: Itinerary): ItineraryFormValues {
  return {
    outbound: itinerary.outbound.segments.map(toSegmentForm),
    return: (itinerary.return?.segments ?? []).map(toSegmentForm),
  };
}

/** A first flight per direction for a new trip: outbound from origin to destination, and back for a return. */
export function itineraryDefaults(
  tripType: TripType,
  origin: Airport | null,
  destination: Airport | null,
  departureDate: string,
  returnDate = '',
): ItineraryFormValues {
  return {
    outbound: [newSegment({ origin, destination, departure_date: departureDate, arrival_date: departureDate })],
    return:
      tripType === 'return'
        ? [
            newSegment({
              origin: destination,
              destination: origin,
              departure_date: returnDate,
              arrival_date: returnDate,
            }),
          ]
        : [],
  };
}

const airport = z.custom<Airport | null>().refine((value) => value !== null, 'Choose an airport.');

const segmentSchema = z.object({
  airline: z.custom<Airline | null>().refine((value) => value !== null, 'Choose the airline.'),
  flight_number: z
    .string()
    .trim()
    .regex(/^\d{1,4}[A-Za-z]?$/, '1 to 4 digits and an optional letter.'),
  operating_airline: z.custom<Airline | null>(),
  origin: airport,
  destination: airport,
  departure_date: dateString('Enter the date.'),
  departure_time: z.string().regex(TIME, 'Enter the time.'),
  arrival_date: dateString('Enter the date.'),
  arrival_time: z.string().regex(TIME, 'Enter the time.'),
});

/** Each flight is checked in checkItinerary, which knows whether the return flights count. */
export const itinerarySchema = z.object({
  outbound: z.array(z.custom<SegmentFormValues>()),
  return: z.array(z.custom<SegmentFormValues>()),
});

const departs = (segment: SegmentFormValues) => `${segment.departure_date}T${segment.departure_time}`;
const arrives = (segment: SegmentFormValues) => `${segment.arrival_date}T${segment.arrival_time}`;

/** Days from departure to arrival date, or null while either is missing. */
function arrivalDays(segment: SegmentFormValues): number | null {
  const days = (Date.parse(segment.arrival_date) - Date.parse(segment.departure_date)) / 86_400_000;
  return Number.isNaN(days) ? null : Math.round(days);
}

/**
 * Mirrors the server's itinerary rules, adding issues at segments.<direction>.<index>.<field>.
 * route: the airports the outbound flights must start and end at, when fixed (confirming a booking).
 */
export function checkItinerary(
  ctx: z.RefinementCtx,
  tripType: TripType,
  segments: ItineraryFormValues,
  route?: { origin: Airport; destination: Airport },
) {
  const issue = (direction: Direction, index: number, field: keyof SegmentFormValues, message: string) =>
    ctx.addIssue({ code: 'custom', path: ['segments', direction, index, field], message });
  const directions: Direction[] = tripType === 'return' ? ['outbound', 'return'] : ['outbound'];

  for (const direction of directions) {
    const flights = segments[direction];
    if (flights.length === 0 || flights.length > MAX_FLIGHTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['segments', direction],
        message: flights.length
          ? `At most ${MAX_FLIGHTS} flights.`
          : direction === 'return'
            ? 'Add the return flights.'
            : 'Add the outbound flights.',
      });
    }
    flights.forEach((flight, index) => {
      for (const found of segmentSchema.safeParse(flight).error?.issues ?? []) {
        ctx.addIssue({ code: 'custom', path: ['segments', direction, index, ...found.path], message: found.message });
      }
      if (flight.origin && flight.destination && flight.origin.code === flight.destination.code) {
        issue(direction, index, 'destination', 'From and To must differ.');
      }
      const days = arrivalDays(flight);
      if (days !== null && (days < -1 || days > 2)) {
        issue(direction, index, 'arrival_date', 'Between one day before and two days after the departure.');
      }
      const previous = flights[index - 1];
      if (!previous) {
        return;
      }
      if (previous.destination && flight.origin && previous.destination.code !== flight.origin.code) {
        issue(
          direction,
          index,
          'origin',
          `Must leave from ${previous.destination.code}, where flight ${index} arrives.`,
        );
      } else if (
        TIME.test(previous.arrival_time) &&
        TIME.test(flight.departure_time) &&
        departs(flight) <= arrives(previous)
      ) {
        issue(direction, index, 'departure_time', `Must leave after flight ${index} arrives.`);
      }
    });
  }

  const outbound = segments.outbound;
  const start = outbound[0]?.origin;
  const end = outbound[outbound.length - 1]?.destination;
  if (route) {
    if (start && start.code !== route.origin.code) {
      issue('outbound', 0, 'origin', `Must leave from ${route.origin.code}.`);
    }
    if (end && end.code !== route.destination.code) {
      issue('outbound', outbound.length - 1, 'destination', `Must arrive at ${route.destination.code}.`);
    }
  } else if (start && end && start.code === end.code && outbound.length > 1) {
    issue('outbound', outbound.length - 1, 'destination', 'Must end somewhere other than where the trip starts.');
  }

  const back = segments.return;
  if (tripType === 'return' && back.length > 0) {
    const first = back[0];
    const last = back[back.length - 1];
    if (end && first.origin && first.origin.code !== end.code) {
      issue('return', 0, 'origin', `Must leave from ${end.code}, where the outbound flights arrive.`);
    }
    if (start && last.destination && last.destination.code !== start.code) {
      issue('return', back.length - 1, 'destination', `Must arrive at ${start.code}, where the trip starts.`);
    }
    const arrived = outbound[outbound.length - 1];
    if (
      arrived &&
      TIME.test(arrived.arrival_time) &&
      TIME.test(first.departure_time) &&
      departs(first) <= arrives(arrived)
    ) {
      issue('return', 0, 'departure_time', 'Must leave after the outbound flights arrive.');
    }
  }
}

/** The API's single ordered segment list; a one-way trip sends no return flights. */
export function toSegmentsBody(tripType: TripType, segments: ItineraryFormValues) {
  const directions: Direction[] = tripType === 'return' ? ['outbound', 'return'] : ['outbound'];
  return directions.flatMap((direction) =>
    segments[direction].map((segment) => ({
      direction,
      airline: segment.airline?.id,
      flight_number: segment.flight_number.trim().toUpperCase(),
      operating_airline: segment.operating_airline?.id ?? null,
      origin: segment.origin?.code,
      destination: segment.destination?.code,
      departure_date: segment.departure_date,
      departure_time: segment.departure_time,
      arrival_date: segment.arrival_date,
      arrival_time: segment.arrival_time,
    })),
  );
}

export type OfferFormValues = {
  trip_type: TripType;
  segments: ItineraryFormValues;
  ticket_class: TicketClass;
  price: string;
  /** The ticketing airline. */
  airline: Airline | null;
  valid_until: string;
  is_public: boolean;
  /** "0" to "3". */
  checked_bags: string;
  checked_bag_kg: string;
  cabin_bag_kg: string;
  refund_policy: Policy;
  change_policy: Policy;
};

/** A new offer's values; custom offers start from a request's or booking's trip. */
export function offerDefaults(values: Partial<OfferFormValues> = {}): OfferFormValues {
  return {
    trip_type: 'one_way',
    segments: itineraryDefaults('one_way', null, null, ''),
    ticket_class: 'economy',
    price: '',
    airline: null,
    valid_until: '',
    is_public: true,
    checked_bags: '0',
    checked_bag_kg: '',
    cabin_bag_kg: '',
    refund_policy: 'not_allowed',
    change_policy: 'not_allowed',
    ...values,
  };
}

const optionalKg = z
  .string()
  .trim()
  .regex(/^([1-9]\d{0,2})?$/, 'Whole kilograms, e.g. 23.');

/** Mirrors the server's offer rules; "valid until" may not be in the past on create only. */
export function offerSchema(isCreate: boolean) {
  return z
    .object({
      trip_type: z.enum(['one_way', 'return']),
      segments: itinerarySchema,
      ticket_class: z.enum(['economy', 'premium_economy', 'business', 'first']),
      price: z
        .string()
        .trim()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a price in USD, e.g. 650 or 650.50.')
        .refine((value) => Number(value) > 0, 'Price must be greater than 0.'),
      airline: z.custom<Airline | null>().refine((value) => value !== null, 'Choose the ticketing airline.'),
      valid_until: dateString('Enter the last day this offer is valid.'),
      is_public: z.boolean(),
      checked_bags: z.string().regex(/^[0-3]$/, 'From none to 3 bags.'),
      checked_bag_kg: optionalKg,
      cabin_bag_kg: optionalKg,
      refund_policy: z.enum(['not_allowed', 'with_fee', 'free']),
      change_policy: z.enum(['not_allowed', 'with_fee', 'free']),
    })
    .superRefine((values, ctx) => {
      checkItinerary(ctx, values.trip_type, values.segments);
      const departure = values.segments.outbound[0]?.departure_date;
      if (departure && DATE.test(departure) && values.valid_until > departure) {
        ctx.addIssue({
          code: 'custom',
          path: ['valid_until'],
          message: 'Valid until must be on or before the departure date.',
        });
      }
      if (isCreate && values.valid_until < todayInNairobi()) {
        ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'Valid until cannot be in the past.' });
      }
    });
}

/** The API body for a validated form. */
export function toOfferBody(values: OfferFormValues) {
  const kg = (value: string) => (value.trim() ? Number(value.trim()) : null);
  const checkedBags = Number(values.checked_bags);
  return {
    trip_type: values.trip_type,
    segments: toSegmentsBody(values.trip_type, values.segments),
    ticket_class: values.ticket_class,
    price: values.price.trim(),
    airline: values.airline?.id,
    valid_until: values.valid_until,
    is_public: values.is_public,
    checked_bags: checkedBags,
    // No weight without a checked bag.
    checked_bag_kg: checkedBags ? kg(values.checked_bag_kg) : null,
    cabin_bag_kg: kg(values.cabin_bag_kg),
    refund_policy: values.refund_policy,
    change_policy: values.change_policy,
  };
}

/** The values for editing an existing offer or booking's trip. */
export function tripFormValues(trip: {
  checked_bags: number;
  checked_bag_kg: number | null;
  cabin_bag_kg: number | null;
}): Pick<OfferFormValues, 'checked_bags' | 'checked_bag_kg' | 'cabin_bag_kg'> {
  return {
    checked_bags: String(trip.checked_bags),
    checked_bag_kg: trip.checked_bag_kg === null ? '' : String(trip.checked_bag_kg),
    cabin_bag_kg: trip.cabin_bag_kg === null ? '' : String(trip.cabin_bag_kg),
  };
}
