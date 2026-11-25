import { AdminTour, NotBookableReason, TourBookingStatus, TourOption } from '../api/types';
import { Tone } from '../components/StatusChip';
import { formatDate, formatPrice, todayInNairobi } from './format';

export const TOUR_BOOKING_STATUS: Record<TourBookingStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  completed: { label: 'Completed', tone: 'neutral' },
};

export const TOUR_EVENT_LABELS: Record<TourBookingStatus, string> = {
  confirmed: 'Booked',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

export const NOT_BOOKABLE: Record<NotBookableReason, string> = {
  fully_booked: 'This tour is fully booked.',
  closed: 'Bookings for this tour are closed.',
  cancelled: 'This tour has been cancelled.',
};

/** e.g. "Wed, 10 Jun 2026 – Fri, 12 Jun 2026 · 3 days". */
export function tourDates(tour: { start_date: string; end_date: string; duration_days: number }): string {
  const days = `${tour.duration_days} day${tour.duration_days === 1 ? '' : 's'}`;
  return `${formatDate(tour.start_date)} – ${formatDate(tour.end_date)} · ${days}`;
}

export function peopleLabel(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

/** What one unit costs and covers, e.g. "$300.00 per person" or "$900.00 for 2 people". */
export function unitPrice(option: Pick<TourOption, 'price' | 'people_per_unit'>): string {
  const per = option.people_per_unit === 1 ? 'per person' : `for ${option.people_per_unit} people`;
  return `${formatPrice(option.price)} ${per}`;
}

export function slotsLeftLabel(count: number): string {
  return `${count} slot${count === 1 ? '' : 's'} left`;
}

export type AdminTourStatus = 'Upcoming' | 'Fully booked' | 'Closed' | 'Past' | 'Inactive' | 'Cancelled';

export function adminTourStatus(tour: AdminTour): { label: AdminTourStatus; tone: Tone } {
  if (tour.cancelled_at) {
    return { label: 'Cancelled', tone: 'danger' };
  }
  if (tour.end_date < todayInNairobi()) {
    return { label: 'Past', tone: 'neutral' };
  }
  if (!tour.is_active) {
    return { label: 'Inactive', tone: 'neutral' };
  }
  if (tour.slots_left === 0 || tour.not_bookable_reason === 'fully_booked') {
    return { label: 'Fully booked', tone: 'warning' };
  }
  if (!tour.bookable) {
    return { label: 'Closed', tone: 'warning' };
  }
  return { label: 'Upcoming', tone: 'success' };
}

/** The day before the start, as the tour form proposes for both deadlines. */
export function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
