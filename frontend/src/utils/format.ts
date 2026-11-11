import { Policy, Segment, TICKET_CLASSES, TicketClass, Trip } from '../api/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatPrice(amount: string | number): string {
  return usd.format(Number(amount));
}

/** An amount in the given currency (the platform's plans and invoices), e.g. "KES 1,000.00". */
export function formatMoney(amount: string | number, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Formats a calendar date ("YYYY-MM-DD") without shifting it across time zones. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Today's date in Nairobi as "YYYY-MM-DD". */
export function todayInNairobi(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

/** "Direct" or "N stop(s)"; counts layovers and stopovers alike. */
export function stopsLabel(count: number): string {
  if (count === 0) {
    return 'Direct';
  }
  return `${count} stop${count === 1 ? '' : 's'}`;
}

/** e.g. "2 h 15 min", "45 min", "26 h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ');
}

export function ticketClassLabel(value: TicketClass): string {
  return TICKET_CLASSES.find((option) => option.value === value)?.label ?? value;
}

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Nairobi',
});

export function formatDateTime(isoDateTime: string): string {
  return `${dateTimeFormat.format(new Date(isoDateTime))} (Nairobi)`;
}

/** How long ago a moment was, roughly: "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(isoDateTime: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(isoDateTime)) / 60_000));
  const [count, unit] =
    minutes < 1 ? [0, ''] : minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
  return count === 0 ? 'just now' : `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** "+1" when a flight lands the day after it leaves ("-1", "+2" likewise); empty on the same day. */
export function dayOffset(departureDate: string, arrivalDate: string): string {
  const days = Math.round((Date.parse(arrivalDate) - Date.parse(departureDate)) / 86_400_000);
  return days === 0 || Number.isNaN(days) ? '' : `${days > 0 ? '+' : ''}${days}`;
}

/** e.g. "KQ 310". */
export function flightNumber(segment: Pick<Segment, 'airline' | 'flight_number'>): string {
  return `${segment.airline.iata_code} ${segment.flight_number}`;
}

/** The departure date, or "departure – return" for a return trip. */
export function tripDates(trip: { departure_date: string; return_date: string | null }): string {
  return trip.return_date
    ? `${formatDate(trip.departure_date)} – ${formatDate(trip.return_date)}`
    : formatDate(trip.departure_date);
}

type Baggage = Pick<Trip, 'checked_bags' | 'checked_bag_kg' | 'cabin_bag_kg'>;

/** Short, for result rows: "23 kg checked", "2 × 23 kg checked", "1 checked bag" or "Cabin bag only". */
export function baggageSummary(trip: Baggage): string {
  if (!trip.checked_bags) {
    return 'Cabin bag only';
  }
  if (trip.checked_bag_kg) {
    return `${trip.checked_bags > 1 ? `${trip.checked_bags} × ` : ''}${trip.checked_bag_kg} kg checked`;
  }
  return `${trip.checked_bags} checked bag${trip.checked_bags > 1 ? 's' : ''}`;
}

/** Checked and cabin baggage per passenger, e.g. "1 × 23 kg" and "7 kg". */
export function baggageDetails(trip: Baggage): { checked: string; cabin: string } {
  const checked = !trip.checked_bags
    ? 'None'
    : trip.checked_bag_kg
      ? `${trip.checked_bags} × ${trip.checked_bag_kg} kg`
      : `${trip.checked_bags} bag${trip.checked_bags > 1 ? 's' : ''}, weight not stated`;
  return { checked, cabin: trip.cabin_bag_kg ? `${trip.cabin_bag_kg} kg` : 'Included, weight not stated' };
}

export const POLICIES: { value: Policy; label: string }[] = [
  { value: 'not_allowed', label: 'Not allowed' },
  { value: 'with_fee', label: 'With a fee' },
  { value: 'free', label: 'Free' },
];

const REFUNDS: Record<Policy, string> = {
  not_allowed: 'Non-refundable',
  with_fee: 'Refundable for a fee',
  free: 'Free refunds',
};

const CHANGES: Record<Policy, string> = {
  not_allowed: 'No changes allowed',
  with_fee: 'Changes allowed for a fee',
  free: 'Free changes',
};

export function refundLabel(policy: Policy): string {
  return REFUNDS[policy];
}

export function changeLabel(policy: Policy): string {
  return CHANGES[policy];
}
