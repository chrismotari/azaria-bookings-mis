import { HotelBookingStatus, HotelRate } from '../api/types';
import { formatDate } from './format';

export const HOTEL_EVENT_LABELS: Record<HotelBookingStatus, string> = {
  requested: 'Booking requested',
  availability_confirmed: 'Availability confirmed',
  paid: 'Payment received',
  completed: 'Voucher sent',
  unavailable: 'Rooms unavailable',
  cancelled: 'Cancelled',
  expired: 'Expired',
  declined: 'New total declined',
};

export const MAX_ROOMS = 9;
export const MAX_NIGHTS = 30;

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

export function nightsLabel(nights: number): string {
  return count(nights, 'night', 'nights');
}

export function roomsLabel(rooms: number): string {
  return count(rooms, 'room', 'rooms');
}

/** e.g. "2 adults, 1 child". */
export function guestsLabel(adults: number, children: number): string {
  return [count(adults, 'adult', 'adults'), children ? count(children, 'child', 'children') : '']
    .filter(Boolean)
    .join(', ');
}

/** "14:00" from "14:00:00". */
export function timeLabel(time: string): string {
  return time.slice(0, 5);
}

export function starsLabel(stars: number | null): string {
  return stars ? `${stars}-star` : 'Not rated';
}

/** Nights between two ISO dates (0 when either is missing or out of order). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) {
    return 0;
  }
  const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  return nights > 0 ? nights : 0;
}

/** e.g. "Fri, 10 Apr 2026 – Mon, 13 Apr 2026 · 3 nights". */
export function stayDates(checkIn: string, checkOut: string): string {
  return `${formatDate(checkIn)} – ${formatDate(checkOut)} · ${nightsLabel(nightsBetween(checkIn, checkOut))}`;
}

/** The adults priced on a rate: those asked for, capped at its max; with none, its max. */
export function adultsPriced(rate: Pick<HotelRate, 'max_adults'>, adults?: number): number {
  return adults ? Math.min(adults, rate.max_adults) : rate.max_adults;
}

/** A room's stay price at the rate for these adults, or null without dates or when not offered. */
export function roomStayPrice(rate: HotelRate, adults: number): number | null {
  if (rate.room_price === null || rate.nights === null) {
    return null;
  }
  return Number(rate.room_price) + Number(rate.per_adult_per_night) * adults * rate.nights;
}

export function fitsGuests(rate: Pick<HotelRate, 'max_adults' | 'max_children'>, adults?: number, children?: number) {
  return (adults ?? 0) <= rate.max_adults && (children ?? 0) <= rate.max_children;
}

/** The next day of an ISO date. */
export function dayAfter(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
