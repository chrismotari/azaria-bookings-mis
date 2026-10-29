import { Booking, BookingStatus } from '../api/types';
import { Tone } from '../components/StatusChip';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'warning' },
  availability_confirmed: { label: 'Awaiting payment', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
  unavailable: { label: 'Unavailable', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** What each status means for the timeline. */
export const BOOKING_EVENT_LABELS: Record<BookingStatus, string> = {
  requested: 'Booking requested',
  availability_confirmed: 'Availability confirmed',
  paid: 'Payment received',
  completed: 'Boarding passes sent',
  unavailable: 'Seats unavailable',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export function bookingRoute(booking: Booking): string {
  const { origin, destination } = booking.offering;
  return `${origin.city} (${origin.code}) → ${destination.city} (${destination.code})`;
}

export function passengersLabel(count: number): string {
  return `${count} passenger${count === 1 ? '' : 's'}`;
}
