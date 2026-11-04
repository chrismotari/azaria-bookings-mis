import { Booking, BookingChanges, BookingStatus, StopChange } from '../api/types';
import { Tone } from '../components/StatusChip';
import { formatDuration, formatPrice } from './format';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'warning' },
  availability_confirmed: { label: 'Awaiting payment', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
  unavailable: { label: 'Unavailable', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'neutral' },
};

/** Statuses that end a booking; they show as a banner instead of the progress tracker. */
export const TERMINAL_STATUSES: BookingStatus[] = ['unavailable', 'cancelled', 'expired', 'declined'];

/** What each status means for the timeline. */
export const BOOKING_EVENT_LABELS: Record<BookingStatus, string> = {
  requested: 'Booking requested',
  availability_confirmed: 'Availability confirmed',
  paid: 'Payment received',
  completed: 'Boarding passes sent',
  unavailable: 'Seats unavailable',
  cancelled: 'Cancelled',
  expired: 'Expired',
  declined: 'Changes declined',
};

/** Changes from confirming that the customer has neither accepted nor declined yet. */
export function changesAwaitingAcceptance(booking: Booking): boolean {
  return booking.status === 'availability_confirmed' && booking.changes !== null && !booking.changes_accepted;
}

export function bookingRoute(booking: Booking): string {
  const { origin, destination } = booking.offer;
  return `${origin.city} (${origin.code}) → ${destination.city} (${destination.code})`;
}

export function passengersLabel(count: number): string {
  return `${count} passenger${count === 1 ? '' : 's'}`;
}

/** "12 h 30 min left" until the deadline, or "Deadline passed". */
export function timeLeft(deadline: string, now: number): string {
  const minutes = Math.floor((new Date(deadline).getTime() - now) / 60_000);
  if (minutes < 0) {
    return 'Deadline passed';
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min left` : `${minutes} min left`;
}

const STOPOVER_MINUTES = 24 * 60;

/** e.g. "DXB Dubai, 2 h 15 min layover; MBA Mombasa, 26 h stopover", or "Direct". */
export function stopChangesLabel(stops: StopChange[]): string {
  if (stops.length === 0) {
    return 'Direct';
  }
  return stops
    .map((stop) => {
      const kind = stop.duration_minutes >= STOPOVER_MINUTES ? 'stopover' : 'layover';
      return `${stop.code} ${stop.city}, ${formatDuration(stop.duration_minutes)} ${kind}`;
    })
    .join('; ');
}

/** Each change as label, old and new text. */
export function describeChanges(changes: BookingChanges): { label: string; old: string; new: string }[] {
  const rows = [];
  if (changes.unit_price) {
    rows.push({
      label: 'Price per person',
      old: formatPrice(changes.unit_price.old),
      new: formatPrice(changes.unit_price.new),
    });
  }
  if (changes.stops) {
    rows.push({ label: 'Stops', old: stopChangesLabel(changes.stops.old), new: stopChangesLabel(changes.stops.new) });
  }
  return rows;
}
