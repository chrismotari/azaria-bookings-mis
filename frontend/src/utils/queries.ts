import { Airport, Query, QueryStatus } from '../api/types';
import { Tone } from '../components/StatusChip';
import { formatDate, formatPrice, ticketClassLabel } from './format';

export const QUERY_STATUS: Record<QueryStatus, { label: string; tone: Tone }> = {
  open: { label: 'Waiting for options', tone: 'warning' },
  responded: { label: 'Options sent', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

function place(airport: Airport | null): string {
  return airport ? `${airport.city} (${airport.code})` : 'Anywhere';
}

/** Human-readable lines for what the customer asked for. */
export function describeQuery(query: Query) {
  const { price_min: min, price_max: max } = query;
  return {
    route: `${place(query.origin)} → ${place(query.destination)}`,
    dates: query.date_to
      ? `${formatDate(query.date_from)} – ${formatDate(query.date_to)}`
      : `From ${formatDate(query.date_from)}`,
    prices:
      min && max
        ? `${formatPrice(min)} – ${formatPrice(max)}`
        : min
          ? `From ${formatPrice(min)}`
          : max
            ? `Up to ${formatPrice(max)}`
            : 'Any',
    ticketClass: query.ticket_class ? ticketClassLabel(query.ticket_class) : 'Any',
    maxStopovers: query.max_stopovers === null ? 'Any' : String(query.max_stopovers),
  };
}
