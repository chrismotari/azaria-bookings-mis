import { z } from 'zod';

import { TICKET_CLASSES, TicketClass } from '../api/types';
import { AirportQuery, AirportSearchField } from './AirportPicker';
import { DateField } from './DateField';
import { FieldGrid } from './Field';
import { OptionChips } from './OptionChips';
import { TextField } from './TextField';

export type OfferFilterValues = {
  origin: AirportQuery;
  destination: AirportQuery;
  date_from: string;
  date_to: string;
  price_min: string;
  price_max: string;
  ticket_class: '' | TicketClass;
  max_stopovers: string;
};

export const EMPTY_OFFER_FILTERS: OfferFilterValues = {
  origin: { text: '', airport: null },
  destination: { text: '', airport: null },
  date_from: '',
  date_to: '',
  price_min: '',
  price_max: '',
  ticket_class: '',
  max_stopovers: '',
};

export type OfferFilterErrors = Partial<Record<keyof OfferFilterValues, string>>;

const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d{1,8}(\.\d{1,2})?)?$/, 'Enter an amount, e.g. 500.');

const filterSchema = z
  .object({
    date_from: z.string(),
    date_to: z.string(),
    price_min: optionalAmount,
    price_max: optionalAmount,
    max_stopovers: z
      .string()
      .trim()
      .regex(/^(\d{1,2})?$/, 'Enter a whole number.'),
  })
  .superRefine((values, ctx) => {
    if (values.date_from && values.date_to && values.date_from > values.date_to) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'Must be on or after the start date.' });
    }
    if (values.price_min && values.price_max && Number(values.price_min) > Number(values.price_max)) {
      ctx.addIssue({ code: 'custom', path: ['price_max'], message: 'Must be at least the minimum price.' });
    }
  });

/** Returns a message per invalid field; empty when the filters can be sent. */
export function validateOfferFilters(values: OfferFilterValues): OfferFilterErrors {
  const result = filterSchema.safeParse(values);
  const errors: OfferFilterErrors = {};
  for (const issue of result.error?.issues ?? []) {
    const field = issue.path[0] as keyof OfferFilterValues;
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Query parameters for /offers and /admin/offers; empty filters are left out. */
export function offerFilterParams(values: OfferFilterValues): Record<string, string> {
  const airport = (query: AirportQuery) => query.airport?.code ?? query.text.trim();
  const params: Record<string, string> = {
    origin: airport(values.origin),
    destination: airport(values.destination),
    date_from: values.date_from,
    date_to: values.date_to,
    price_min: values.price_min.trim(),
    price_max: values.price_max.trim(),
    ticket_class: values.ticket_class,
    max_stopovers: values.max_stopovers.trim(),
  };
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ''));
}

const CLASS_OPTIONS: { value: '' | TicketClass; label: string }[] = [{ value: '', label: 'Any' }, ...TICKET_CLASSES];

const AMOUNT_LABELS = { price_min: 'Min price (USD)', price_max: 'Max price (USD)', max_stopovers: 'Max stopovers' };

type Props = {
  value: OfferFilterValues;
  onChange: (value: OfferFilterValues) => void;
  errors: OfferFilterErrors;
  onSubmit: () => void;
  /** False shows only From and To. */
  showDetails?: boolean;
};

export function OfferFilterFields({ value, onChange, errors, onSubmit, showDetails = true }: Props) {
  const set = <K extends keyof OfferFilterValues>(key: K, fieldValue: OfferFilterValues[K]) =>
    onChange({ ...value, [key]: fieldValue });

  return (
    <>
      <FieldGrid>
        <AirportSearchField
          label="From"
          value={value.origin}
          onChange={(query) => set('origin', query)}
          onSubmitEditing={onSubmit}
        />
        <AirportSearchField
          label="To"
          value={value.destination}
          onChange={(query) => set('destination', query)}
          onSubmitEditing={onSubmit}
        />
      </FieldGrid>
      {showDetails ? (
        <>
          <FieldGrid>
            <DateField
              label="Departing from"
              value={value.date_from}
              onChange={(date) => set('date_from', date)}
              error={errors.date_from}
            />
            <DateField
              label="Departing until"
              value={value.date_to}
              onChange={(date) => set('date_to', date)}
              error={errors.date_to}
            />
            {(['price_min', 'price_max', 'max_stopovers'] as const).map((name) => (
              <TextField
                key={name}
                label={AMOUNT_LABELS[name]}
                value={value[name]}
                onChangeText={(text) => set(name, text)}
                error={errors[name]}
                keyboardType={name === 'max_stopovers' ? 'number-pad' : 'decimal-pad'}
                onSubmitEditing={onSubmit}
              />
            ))}
          </FieldGrid>
          <OptionChips
            label="Class"
            options={CLASS_OPTIONS}
            value={value.ticket_class}
            onChange={(ticketClass) => set('ticket_class', ticketClass)}
          />
        </>
      ) : null}
    </>
  );
}
