import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import { FareType, Integration, Route, RouteSchedule, RunStatus, SearchUsage } from '../../api/types';
import { Tone } from '../../components/StatusChip';
import { formatDate, formatMoney } from '../../utils/format';

export const INTEGRATIONS_KEY = ['admin', 'integrations'];
export const ROUTES_KEY = ['admin', 'routes'];
export const FARES_KEY = ['admin', 'fares'];
export const USAGE_KEY = ['admin', 'search-usage'];

export function useIntegrations() {
  return useQuery({
    queryKey: INTEGRATIONS_KEY,
    queryFn: async () => (await api.get<Integration[]>('/admin/integrations')).data,
  });
}

export function useSearchUsage() {
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: async () => (await api.get<SearchUsage>('/admin/search-usage')).data,
  });
}

export const PROVIDERS: { value: Integration['provider']; label: string }[] = [{ value: 'duffel', label: 'Duffel' }];

export function providerLabel(provider: string): string {
  return PROVIDERS.find((option) => option.value === provider)?.label ?? provider;
}

/** Monday first; the value is the weekday number the API uses (0 = Monday). */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function weekdaysLabel(weekdays: number[]): string {
  return weekdays.length === 0 || weekdays.length === 7 ? 'Every day' : weekdays.map((day) => WEEKDAYS[day]).join(', ');
}

export const SCHEDULES: { value: RouteSchedule; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

export function scheduleLabel(route: Route): string {
  if (route.schedule === 'daily') {
    return 'Searched daily';
  }
  if (route.schedule === 'weekly') {
    return `Searched weekly on ${WEEKDAYS[route.schedule_weekday ?? 0]}`;
  }
  return 'Searched by hand';
}

export function windowLabel(route: Route): string {
  if (route.window === 'fixed') {
    return `${formatDate(route.window_from ?? '')} – ${formatDate(route.window_to ?? '')}`;
  }
  return `${route.days_ahead_from} to ${route.days_ahead_to} days ahead`;
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The departure dates a search of the route covers today (ISO dates): its window, without the part already past. */
export function windowDates(route: Route, today: string): { from: string; to: string } {
  if (route.window === 'rolling') {
    return { from: addDays(today, route.days_ahead_from ?? 0), to: addDays(today, route.days_ahead_to ?? 0) };
  }
  const from = route.window_from ?? today;
  return { from: from < today ? today : from, to: route.window_to ?? today };
}

/** Share of the month's allowance from which the Routes screen warns. */
export const USAGE_WARNING = 0.8;

/** The departure dates from one ISO date to another (inclusive) that fall on the weekdays (all when empty). */
export function searchDates(from: string, to: string, weekdays: number[]): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let day = Date.parse(`${from}T00:00:00Z`); day <= end; day += 86_400_000) {
    // getUTCDay: 0 is Sunday; the API's 0 is Monday.
    const weekday = (new Date(day).getUTCDay() + 6) % 7;
    if (weekdays.length === 0 || weekdays.includes(weekday)) {
      dates.push(new Date(day).toISOString().slice(0, 10));
    }
  }
  return dates;
}

/** The integrations a route searches: its chosen active ones, or every active one when it chose none. */
export function routeIntegrationCount(route: Route, integrations: Integration[]): number {
  const active = integrations.filter((integration) => integration.is_active);
  if (route.integrations.length === 0) {
    return active.length;
  }
  const chosen = new Set(route.integrations.map((integration) => integration.id));
  return active.filter((integration) => chosen.has(integration.id)).length;
}

export function tripLabel(route: Route): string {
  return route.trip_type === 'return'
    ? `Return, ${route.stay_nights} night${route.stay_nights === 1 ? '' : 's'}`
    : 'One way';
}

export function connectionsLabel(maxConnections: number | null): string {
  if (maxConnections === null) {
    return 'Any connections';
  }
  return maxConnections === 0 ? 'Direct only' : `Up to ${maxConnections} connection${maxConnections === 1 ? '' : 's'}`;
}

export function pickRuleLabel(route: Route): string {
  const parts = [];
  if (route.pick_cheapest) {
    parts.push(route.max_per_date === 1 ? 'the cheapest' : `the ${route.max_per_date} cheapest`);
  }
  if (route.pick_cheapest_direct) {
    parts.push('the cheapest direct');
  }
  return `Picks ${parts.join(' and ')} per date`;
}

export function markupLabel(route: Route): string {
  const percent = Number(route.markup_percent);
  const fixed = Number(route.markup_fixed);
  if (!percent && !fixed) {
    return 'No markup';
  }
  return [percent ? `${percent}%` : '', fixed ? `${formatMoney(fixed, 'USD')}` : ''].filter(Boolean).join(' + ');
}

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'warning' },
};

export function runDates(run: { date_from: string; date_to: string }): string {
  return run.date_from === run.date_to ? formatDate(run.date_from) : `${formatDate(run.date_from)} – ${formatDate(run.date_to)}`;
}

export const FARE_TYPES: Record<FareType, string> = {
  public: 'Public fare',
  private: 'Private fare',
  unknown: 'Fare type unknown',
};
