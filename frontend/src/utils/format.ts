import { TICKET_CLASSES, TicketClass } from '../api/types';

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

/** Formats a timestamp in Nairobi time. */
export function formatDateTime(isoDateTime: string): string {
  return `${dateTimeFormat.format(new Date(isoDateTime))} (Nairobi)`;
}
