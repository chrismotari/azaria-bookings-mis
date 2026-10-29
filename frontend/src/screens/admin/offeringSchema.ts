import { z } from 'zod';

import { Airport, TicketClass } from '../../api/types';
import { todayInNairobi } from '../../utils/format';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateString = (message: string) =>
  z
    .string()
    .regex(DATE, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), message);

export type OfferingFormValues = {
  origin: Airport | null;
  destination: Airport | null;
  departure_date: string;
  ticket_class: TicketClass;
  price: string;
  stopovers: string;
  airline: string;
  valid_until: string;
  is_public: boolean;
};

const airport = z.custom<Airport | null>().refine((value) => value !== null, 'Choose an airport.');

/** Mirrors the server's offering rules; "valid until" may not be in the past on create only. */
export function offeringSchema(isCreate: boolean) {
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
      stopovers: z
        .string()
        .trim()
        .regex(/^\d{1,2}$/, 'Enter a whole number of stopovers.'),
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
    });
}

/** The API body for a validated form. */
export function toOfferingBody(values: OfferingFormValues) {
  return {
    ...values,
    origin: values.origin?.id,
    destination: values.destination?.id,
    price: values.price.trim(),
    stopovers: Number(values.stopovers),
    airline: values.airline.trim(),
  };
}
