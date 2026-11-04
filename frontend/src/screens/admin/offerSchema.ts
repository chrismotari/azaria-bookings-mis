import { z } from 'zod';

import { Airport, Stop, TicketClass } from '../../api/types';
import { todayInNairobi } from '../../utils/format';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateString = (message: string) =>
  z
    .string()
    .regex(DATE, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), message);

/** The most stops a flight may have (the server's rule too). */
export const MAX_STOPS = 4;

/** A stop's duration as typed: whole hours and minutes, either may be blank. */
export type StopFormValues = {
  airport: Airport | null;
  hours: string;
  minutes: string;
};

export const EMPTY_STOP: StopFormValues = { airport: null, hours: '', minutes: '' };

export function stopMinutes(stop: Pick<StopFormValues, 'hours' | 'minutes'>): number {
  return Number(stop.hours.trim() || 0) * 60 + Number(stop.minutes.trim() || 0);
}

export function toStopFormValues(stops: Stop[]): StopFormValues[] {
  return stops.map((stop) => ({
    airport: stop.airport,
    hours: String(Math.floor(stop.duration_minutes / 60)),
    minutes: String(stop.duration_minutes % 60),
  }));
}

export type OfferFormValues = {
  origin: Airport | null;
  destination: Airport | null;
  departure_date: string;
  ticket_class: TicketClass;
  price: string;
  stops: StopFormValues[];
  airline: string;
  valid_until: string;
  is_public: boolean;
};

const airport = z.custom<Airport | null>().refine((value) => value !== null, 'Choose an airport.');

export const stopSchema = z
  .object({
    airport,
    hours: z.string().trim().regex(/^\d{0,3}$/, 'Whole hours.'),
    minutes: z
      .string()
      .trim()
      .regex(/^\d{0,2}$/, 'Whole minutes.')
      .refine((value) => Number(value || 0) < 60, 'Under 60.'),
  })
  .refine((value) => stopMinutes(value) > 0, { path: ['hours'], message: 'Enter how long the stop lasts.' });

export const stopsSchema = z.array(stopSchema).max(MAX_STOPS, `A flight can have at most ${MAX_STOPS} stops.`);

/** Adds an issue to each stop whose airport is the origin, the destination or the stop before it. */
export function checkStopAirports(
  ctx: z.RefinementCtx,
  origin: Airport | null,
  destination: Airport | null,
  stops: StopFormValues[],
) {
  stops.forEach((item, index) => {
    const code = item.airport?.code;
    const previous = index > 0 ? stops[index - 1].airport?.code : undefined;
    const message =
      code === undefined
        ? null
        : code === origin?.code
          ? 'Must differ from the origin.'
          : code === destination?.code
            ? 'Must differ from the destination.'
            : code === previous
              ? 'Must differ from the stop before it.'
              : null;
    if (message) {
      ctx.addIssue({ code: 'custom', path: ['stops', index, 'airport'], message });
    }
  });
}

/** The API body for a validated stop list. */
export function toStopsBody(stops: StopFormValues[]) {
  return stops.map((item) => ({ airport: item.airport?.code, duration_minutes: stopMinutes(item) }));
}

/** Mirrors the server's offer rules; "valid until" may not be in the past on create only. */
export function offerSchema(isCreate: boolean) {
  return z
    .object({
      origin: airport,
      destination: airport,
      departure_date: dateString('Enter the departure date.'),
      ticket_class: z.enum(['economy', 'premium_economy', 'business', 'first']),
      price: z
        .string()
        .trim()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a price in USD, e.g. 650 or 650.50.')
        .refine((value) => Number(value) > 0, 'Price must be greater than 0.'),
      stops: stopsSchema,
      airline: z.string().trim().min(1, 'Enter the airline.').max(100),
      valid_until: dateString('Enter the last day this offer is valid.'),
      is_public: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (values.origin && values.destination && values.origin.id === values.destination.id) {
        ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Destination must differ from origin.' });
      }
      if (values.valid_until > values.departure_date) {
        ctx.addIssue({
          code: 'custom',
          path: ['valid_until'],
          message: 'Valid until must be on or before the departure date.',
        });
      }
      if (isCreate && values.valid_until < todayInNairobi()) {
        ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'Valid until cannot be in the past.' });
      }
      checkStopAirports(ctx, values.origin, values.destination, values.stops);
    });
}

/** The API body for a validated form. */
export function toOfferBody(values: OfferFormValues) {
  return {
    ...values,
    origin: values.origin?.id,
    destination: values.destination?.id,
    price: values.price.trim(),
    stops: toStopsBody(values.stops),
    airline: values.airline.trim(),
  };
}
