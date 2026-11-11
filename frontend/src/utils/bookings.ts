import { Booking, BookingChanges, BookingStatus, SegmentChange } from '../api/types';
import { Tone } from '../components/StatusChip';
import { formatPrice } from './format';

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
  const arrow = booking.trip_type === 'return' ? '⇄' : '→';
  return `${origin.city} (${origin.code}) ${arrow} ${destination.city} (${destination.code})`;
}

/** The booking's own travel dates (its outbound flights and return date). */
export function bookingDates(booking: Booking): { departure_date: string; return_date: string | null } {
  return {
    departure_date: booking.itinerary.outbound.segments[0]?.departure_date ?? booking.offer.departure_date,
    return_date: booking.return_date,
  };
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

/** One line per flight, e.g. "Outbound KQ 310 NBO → DXB, Fri, 10 Apr 2026 23:50 – 05:40". */
function segmentChangesLabel(segments: SegmentChange[]): string {
  return segments
    .map((line) => {
      const direction = line.direction === 'return' ? 'Return' : 'Outbound';
      return `${direction} ${line.flight} ${line.route}, ${line.departure} – ${line.arrival}`;
    })
    .join('\n');
}

export function describeChanges(changes: BookingChanges): { label: string; old: string; new: string }[] {
  const rows = [];
  if (changes.unit_price) {
    rows.push({
      label: 'Price per person',
      old: formatPrice(changes.unit_price.old),
      new: formatPrice(changes.unit_price.new),
    });
  }
  if (changes.airline) {
    rows.push({ label: 'Ticketing airline', old: changes.airline.old, new: changes.airline.new });
  }
  if (changes.segments) {
    rows.push({
      label: 'Flights',
      old: segmentChangesLabel(changes.segments.old),
      new: segmentChangesLabel(changes.segments.new),
    });
  }
  return rows;
}
