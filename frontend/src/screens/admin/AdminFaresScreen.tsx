import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Fare, FareHistoryPoint, FareList, Paginated, Route, SearchRun } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { Dialog } from '../../components/Dialog';
import { Field, FormError } from '../../components/Field';
import { DirectionLine, directionsOf } from '../../components/Itinerary';
import { PriceTag } from '../../components/PriceTag';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, radius, space, useIsWide, weight } from '../../theme';
import {
  baggageSummary,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPrice,
  ticketClassLabel,
  todayInNairobi,
} from '../../utils/format';
import { FARES_KEY, FARE_TYPES, ROUTES_KEY, RUN_STATUS, runDates, tripLabel } from './gds';

type Show = 'picked' | 'all';

const SHOW: { value: Show; label: string }[] = [
  { value: 'picked', label: 'Picked' },
  { value: 'all', label: 'All results' },
];

/** A route's fares from one run (the latest unless chosen), grouped by departure date and cheapest first in USD. */
export function AdminFaresScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminFares'>) {
  const routeId = route.params.route;
  const runId = route.params.run;
  const [show, setShow] = useState<Show>('picked');

  const detail = useQuery({
    queryKey: [...ROUTES_KEY, 'detail', routeId],
    queryFn: async () => (await api.get<Route>(`/admin/routes/${routeId}`)).data,
  });
  const runs = useQuery({
    queryKey: [...ROUTES_KEY, 'runs', routeId],
    queryFn: async () => (await api.get<Paginated<SearchRun>>(`/admin/routes/${routeId}/runs`)).data,
  });
  const fares = useQuery({
    queryKey: [...FARES_KEY, routeId, runId ?? 'latest', show],
    queryFn: async () =>
      (
        await api.get<FareList>('/admin/fares', {
          params: { route: routeId, ...(runId ? { run: runId } : {}), ...(show === 'picked' ? { picked: 'true' } : {}) },
        })
      ).data,
  });

  const back = () => navigation.navigate('AdminRoutes', { id: routeId });
  // Skipped runs searched nothing.
  const runOptions = (runs.data?.results ?? []).filter((run) => run.status !== 'skipped').map((run, index) => ({
    value: index === 0 && !runId ? '' : run.id,
    label: `${runDates(run)} · searched ${formatDateTime(run.created_at)}${index === 0 ? ' (latest)' : ''}`,
  }));

  return (
    <Screen>
      <BackLink label="Routes" onPress={back} />
      <View>
        <Text style={styles.title}>
          Fares
          {detail.data
            ? ` · ${detail.data.origin.code} ${detail.data.trip_type === 'return' ? '⇄' : '→'} ${detail.data.destination.code}`
            : ''}
        </Text>
        {detail.data ? (
          <Text style={styles.muted}>
            {tripLabel(detail.data)} · {ticketClassLabel(detail.data.ticket_class)}
          </Text>
        ) : null}
      </View>

      <Card>
        <View style={styles.controls}>
          <View style={styles.control}>
            <Field label="Show">
              <SegmentedControl label="Show" options={SHOW} value={show} onChange={setShow} />
            </Field>
          </View>
          {runOptions.length > 0 ? (
            <View style={styles.control}>
              <SelectField
                label="Run"
                options={runOptions}
                value={runId ?? ''}
                onChange={(value) => navigation.setParams({ run: value || undefined })}
              />
            </View>
          ) : null}
        </View>
        {fares.data?.run ? <RunSummary run={fares.data.run} /> : null}
      </Card>

      {fares.isPending ? (
        <LoadingState />
      ) : fares.isError ? (
        <ErrorState error={fares.error} onRetry={() => fares.refetch()} />
      ) : !fares.data.run ? (
        <EmptyState
          icon="search-outline"
          title="Not searched yet"
          message="Use Search now on the route to look for fares."
          action={{ title: 'Back to the route', onPress: back }}
        />
      ) : fares.data.dates.length === 0 ? (
        <EmptyState
          icon="airplane-outline"
          title="No fares"
          message={
            show === 'picked'
              ? 'No fare was picked in this run. Switch to All results to see everything it found.'
              : 'This run found no fares to show.'
          }
        />
      ) : (
        fares.data.dates.map((day) => (
          <View key={day.departure_date} style={styles.day}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{formatDate(day.departure_date)}</Text>
              <Text style={styles.muted}>
                {day.fares.length} fare{day.fares.length === 1 ? '' : 's'}
              </Text>
            </View>
            <PriceHistory routeId={routeId} departureDate={day.departure_date} />
            {day.fares.map((fare) => (
              <FareRow key={fare.id} fare={fare} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}

function RunSummary({ run }: { run: SearchRun }) {
  const status = RUN_STATUS[run.status];
  return (
    <View style={styles.runSummary}>
      <View style={styles.inline}>
        <StatusChip label={status.label} tone={status.tone} />
        <Text style={styles.small}>
          {runDates(run)} · {run.searches_made} search{run.searches_made === 1 ? '' : 'es'} · {run.fares_found} fare
          {run.fares_found === 1 ? '' : 's'} found
        </Text>
      </View>
      {run.errors.length ? (
        <Text style={styles.small}>
          {run.errors.length} problem{run.errors.length === 1 ? '' : 's'}: see the route's recent runs.
        </Text>
      ) : null}
    </View>
  );
}

/** The cheapest USD fare of each recent run for this date, as small bars. */
function PriceHistory({ routeId, departureDate }: { routeId: string; departureDate: string }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: [...FARES_KEY, 'history', routeId, departureDate],
    queryFn: async () =>
      (
        await api.get<FareHistoryPoint[]>('/admin/fares/history', {
          params: { route: routeId, departure_date: departureDate },
        })
      ).data,
    enabled: open,
  });

  if (!open) {
    return (
      <View style={styles.start}>
        <Button title="Price history" variant="link" icon="stats-chart-outline" onPress={() => setOpen(true)} />
      </View>
    );
  }
  const points = history.data ?? [];
  const highest = Math.max(...points.map((point) => Number(point.net_usd)), 1);
  return (
    <View style={styles.history}>
      <View style={styles.between}>
        <Text style={styles.small}>Cheapest fare per run, in USD</Text>
        <Button title="Hide" variant="link" onPress={() => setOpen(false)} />
      </View>
      {history.isPending ? (
        <LoadingState />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : points.length === 0 ? (
        <Text style={styles.small}>No converted fares for this date yet.</Text>
      ) : (
        points.slice(-8).map((point) => (
          <View key={point.run} style={styles.historyRow}>
            <Text style={styles.historyLabel} numberOfLines={1}>
              {formatDateTime(point.searched_at).replace(' (Nairobi)', '')}
            </Text>
            <View style={styles.historyTrack}>
              <View style={[styles.historyBar, { width: `${(Number(point.net_usd) / highest) * 100}%` }]} />
            </View>
            <Text style={styles.historyValue}>{formatPrice(point.net_usd)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function FareRow({ fare }: { fare: Fare }) {
  const isWide = useIsWide();
  const queryClient = useQueryClient();
  const [publishing, setPublishing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dismiss = useMutation({
    mutationFn: async () => (await api.post<Fare>(`/admin/fares/${fare.id}/dismiss`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FARES_KEY });
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
  const original = formatMoney(fare.net_amount, fare.net_currency);
  const details = [
    ticketClassLabel(fare.ticket_class),
    FARE_TYPES[fare.fare_type],
    fare.seats_left !== null ? `${fare.seats_left} seat${fare.seats_left === 1 ? '' : 's'} left` : null,
    fare.integration.name,
  ].filter(Boolean);

  return (
    <View style={[styles.fare, fare.status === 'published' && styles.farePublished]}>
      <View style={styles.between}>
        <View style={styles.carrier}>
          <AirlineBadge airline={fare.airline} size={36} />
          <View style={styles.shrink}>
            <Text style={styles.strong} numberOfLines={1}>
              {fare.airline.name}
            </Text>
            <Text style={styles.small}>{details.join(' · ')}</Text>
            <Text style={styles.small}>
              {baggageSummary(fare)}
              {fare.return_date ? ` · Back ${formatDate(fare.return_date)}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.chips}>
          {fare.picked ? <StatusChip label="Picked" tone="info" /> : null}
          {fare.status === 'published' ? <StatusChip label="Published" tone="success" /> : null}
          {fare.status === 'dismissed' ? <StatusChip label="Dismissed" tone="neutral" /> : null}
        </View>
      </View>

      <View style={styles.lines}>
        {directionsOf(fare.itinerary).map(({ key, label, direction }) => (
          <View key={key} style={styles.lineRow}>
            {fare.trip_type === 'return' ? <Text style={styles.lineLabel}>{label}</Text> : null}
            <View style={styles.lineBody}>
              <DirectionLine direction={direction} />
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.between, styles.bottom]}>
        <View style={styles.amounts}>
          <Text style={styles.small}>Net {original}</Text>
          {fare.no_rate ? (
            <Text style={styles.warning}>No rate for {fare.net_currency} yet: cannot be picked or published.</Text>
          ) : (
            <Pressable onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessible={false}>
              <Text style={styles.text}>≈ {formatPrice(fare.net_usd ?? 0)} net in USD</Text>
              {hovered || !isWide ? (
                <Text style={styles.small}>
                  {fare.net_currency === 'USD'
                    ? 'Priced in USD'
                    : `At ${Number(fare.rate).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${fare.net_currency} per USD, rate of ${formatDate(fare.rate_date ?? '')}`}
                </Text>
              ) : null}
            </Pressable>
          )}
        </View>
        {fare.selling_price ? (
          <View style={styles.selling}>
            <Text style={styles.small}>Selling price</Text>
            <PriceTag amount={fare.selling_price} />
          </View>
        ) : null}
      </View>

      <FormError message={dismiss.isError ? errorMessage(dismiss.error) : null} />
      <View style={styles.actions}>
        {fare.status === 'new' ? (
          <>
            <Button title="Dismiss" variant="secondary" onPress={() => dismiss.mutate()} loading={dismiss.isPending} />
            <Button title="Publish" variant="accent" onPress={() => setPublishing(true)} disabled={fare.no_rate} />
          </>
        ) : null}
        {fare.status === 'published' && fare.offer ? <OfferLink offerId={fare.offer} /> : null}
      </View>
      {publishing ? <PublishFareDialog fare={fare} onClose={() => setPublishing(false)} /> : null}
    </View>
  );
}

function OfferLink({ offerId }: { offerId: string }) {
  const navigation = useNavigation();
  return (
    <Button
      title="View offer"
      variant="link"
      onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminOffers', params: { id: offerId } })}
    />
  );
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const PRICE = /^\d{1,8}(\.\d{1,2})?$/;

function PublishFareDialog({ fare, onClose }: { fare: Fare; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = todayInNairobi();
  const inAWeek = addDays(today, 7);
  const [price, setPrice] = useState(fare.selling_price ?? '');
  const [validUntil, setValidUntil] = useState(inAWeek < fare.departure_date ? inAWeek : fare.departure_date);
  const [isPublic, setIsPublic] = useState(true);
  const [errors, setErrors] = useState<{ price?: string; valid_until?: string }>({});
  const publish = useMutation({
    mutationFn: async () =>
      (await api.post<Fare>(`/admin/fares/${fare.id}/publish`, { price, valid_until: validUntil, is_public: isPublic }))
        .data,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FARES_KEY }),
        queryClient.invalidateQueries({ queryKey: ROUTES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
      ]);
      onClose();
    },
  });

  const submit = () => {
    const found: typeof errors = {};
    if (!PRICE.test(price.trim()) || Number(price) <= 0) {
      found.price = 'Enter a price in USD greater than 0, e.g. 650 or 649.99.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
      found.valid_until = 'Choose a date.';
    } else if (validUntil < today) {
      found.valid_until = 'Valid until cannot be in the past.';
    } else if (validUntil > fare.departure_date) {
      found.valid_until = 'Valid until must be on or before the departure date.';
    }
    setErrors(found);
    if (Object.keys(found).length === 0) {
      publish.mutate();
    }
  };

  return (
    <Dialog
      open
      title="Publish fare"
      onClose={onClose}
      busy={publish.isPending}
      error={publish.isError ? errorMessage(publish.error) : null}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={publish.isPending} />
          <Button title="Publish offer" variant="accent" onPress={submit} loading={publish.isPending} />
        </>
      }
    >
      <View style={styles.summary}>
        <Line label="Provider price" value={formatMoney(fare.net_amount, fare.net_currency)} />
        <Line label="In USD" value={formatPrice(fare.net_usd ?? 0)} />
        {fare.net_currency !== 'USD' && fare.rate_date ? (
          <Line label="Rate date" value={formatDate(fare.rate_date)} />
        ) : null}
        <Line label="Selling price with markup" value={formatPrice(fare.selling_price ?? 0)} />
      </View>
      <Text style={styles.small}>
        Creates an offer with these flights, baggage and conditions; if an active offer already has the same flights,
        its price is updated instead.
      </Text>
      <TextField
        label="Price per person (USD)"
        value={price}
        onChangeText={setPrice}
        error={errors.price}
        keyboardType="decimal-pad"
      />
      <DateField label="Valid until" value={validUntil} onChange={setValidUntil} error={errors.valid_until} />
      <Toggle label={isPublic ? 'Public: listed on Explore' : 'Private'} value={isPublic} onChange={setIsPublic} />
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.between}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.strong}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { color: colors.muted },
  small: { fontSize: font.small, color: colors.muted },
  text: { color: colors.text, fontWeight: weight.semibold },
  strong: { fontWeight: weight.bold, color: colors.text },
  warning: { fontSize: font.small, color: colors.warningText, fontWeight: weight.semibold },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  control: { flexGrow: 1, flexBasis: 260, minWidth: 0 },
  runSummary: { gap: space.xs },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  day: { gap: space.sm },
  dayHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.sm },
  dayTitle: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  start: { alignItems: 'flex-start' },
  history: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  historyLabel: { width: 130, fontSize: font.caption, color: colors.muted },
  historyTrack: { flex: 1, minWidth: 0, height: 8, borderRadius: 4, backgroundColor: colors.neutralTint },
  historyBar: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  historyValue: { width: 80, textAlign: 'right', fontSize: font.small, fontWeight: weight.semibold, color: colors.text },
  fare: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  farePublished: { borderColor: colors.successText },
  between: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  bottom: { alignItems: 'flex-end' },
  carrier: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  lines: { gap: space.md },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineLabel: { width: 60, fontSize: font.caption, fontWeight: weight.bold, color: colors.muted },
  lineBody: { flex: 1, minWidth: 0 },
  amounts: { gap: 2, flexShrink: 1, minWidth: 0 },
  selling: { alignItems: 'flex-end', gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: space.sm },
  summary: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.background },
});
