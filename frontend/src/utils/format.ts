import { TICKET_CLASSES, TicketClass } from '../api/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatPrice(amount: string | number): string {
  return usd.format(Number(amount));
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

export function stopoversLabel(stopovers: number): string {
  if (stopovers === 0) {
    return 'Direct';
  }
  return `${stopovers} stop${stopovers === 1 ? '' : 's'}`;
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

/** Formats a timestamp in Nairobi time. */
export function formatDateTime(isoDateTime: string): string {
  return `${dateTimeFormat.format(new Date(isoDateTime))} (Nairobi)`;
}
