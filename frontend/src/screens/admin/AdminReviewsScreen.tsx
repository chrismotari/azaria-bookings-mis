import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { useModules } from '../../agency/modules';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminReview, Paginated, ReviewKind } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { FormError } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { FLIGHT_REVIEW_NOTE, Stars } from '../../components/Reviews';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow, TwoLineCell } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { AdminTabParamList, AdminReviewFilters } from '../../navigation/types';
import { colors, createStyles, font, space, useIsWide, weight } from '../../theme';
import { formatDateTime, formatDay } from '../../utils/format';

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminReviews'>;

const KIND_LABELS: Record<ReviewKind, string> = { flight: 'Flight', tour: 'Tour', hotel: 'Hotel' };
const KIND_OF_MODULE = { flights: 'flight', tours: 'tour', hotels: 'hotel' } as const;

const RATINGS: { value: string; label: string }[] = [
  { value: '', label: 'Any rating' },
  ...[5, 4, 3, 2, 1].map((stars) => ({ value: String(stars), label: `${stars} star${stars === 1 ? '' : 's'}` })),
];
const VISIBILITY: { value: '' | 'false' | 'true'; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'false', label: 'Visible' },
  { value: 'true', label: 'Hidden' },
];
const REPLIED: { value: '' | 'true' | 'false'; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Replied' },
  { value: 'false', label: 'Not replied' },
];

/** "Maasai Mara, 3 days", or "Flight booking" with its route line. */
function itemTitle(review: AdminReview): { primary: string; secondary?: string } {
  return review.kind === 'flight'
    ? { primary: 'Flight booking', secondary: review.booking.title }
    : { primary: review.booking.title };
}

function firstLine(text: string): string {
  return text.split('\n')[0] || '—';
}

function statusWords(review: AdminReview): string {
  return [review.reply ? 'replied' : 'not replied', review.is_hidden ? 'hidden' : ''].filter(Boolean).join(', ');
}

export function AdminReviewsScreen({ navigation, route }: Props) {
  const isWide = useIsWide();
  const modules = useModules();
  const withKinds = modules.length > 1;
  const params = route.params ?? {};
  const selected = params.id;
  const filters: AdminReviewFilters = {
    kind: params.kind,
    tour: params.tour,
    hotel: params.hotel,
    rating: params.rating,
    hidden: params.hidden,
    replied: params.replied,
  };
  const filterKey = JSON.stringify(filters);
  const [page, setPage] = useState(1);
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const setFilter = (next: Partial<AdminReviewFilters>) => {
    setPage(1);
    navigation.setParams({ ...next, id: undefined });
  };
  const reviews = useQuery({
    queryKey: ['admin', 'reviews', filterKey, page],
    queryFn: async () => {
      const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      return (await api.get<Paginated<AdminReview>>('/admin/reviews', { params: { ...query, page } })).data;
    },
    placeholderData: keepPreviousData,
  });
  const open = (id: string) => navigation.setParams({ id });
  const filtered = Object.values(filters).some(Boolean);
  const itemFilter = filters.tour ?? filters.hotel;
  const itemName = reviews.data?.results.find((review) => review.item?.id === itemFilter)?.item?.title;
  const columns: Column[] = [
    { label: 'Rating', flex: 1.2 },
    ...(withKinds ? [{ label: 'Kind', flex: 0.8 }] : []),
    { label: 'Item', flex: 2.2 },
    { label: 'Customer', flex: 1.8 },
    { label: 'Comment', flex: 2.6 },
    { label: 'Date', flex: 1.3 },
    { label: 'Status', flex: 1.4 },
  ];

  return (
    <DetailLayout
      title="Review"
      backLabel="All reviews"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Reviews',
        items: reviews.data?.results.map((review) => {
          const item = itemTitle(review);
          return {
            id: review.id,
            primary: `${review.rating}★ ${item.secondary ?? item.primary}`,
            secondary: formatDay(review.created_at),
            accessibilityLabel: `${review.rating} stars, ${item.primary} ${item.secondary ?? ''}, ${review.customer.full_name}, ${statusWords(review)}`,
          };
        }),
        onSelect: open,
        page,
        count: reviews.data?.count,
        onPage: setPage,
      }}
      detail={
        selected ? (
          <AdminReviewDetailView
            key={selected}
            id={selected}
            onOpenBooking={(review) => {
              if (review.kind === 'flight') {
                navigation.navigate('AdminBookings', { id: review.booking.id });
              } else if (review.kind === 'tour') {
                navigation.navigate('AdminTours', { id: review.item?.id, booking: review.booking.id });
              } else {
                navigation.navigate('AdminHotels', { id: review.booking.id });
              }
            }}
            onOpenCustomer={(id) => navigation.navigate('AdminUsers', { id })}
          />
        ) : null
      }
      list={
        <Screen card>
          <Text style={styles.title}>Reviews</Text>
          {itemFilter ? (
            <View style={styles.itemFilter}>
              <Text style={styles.text}>
                Reviews of <Text style={styles.strong}>{itemName ?? (filters.tour ? 'this tour' : 'this hotel')}</Text>
              </Text>
              <Button
                title="Show all"
                variant="link"
                onPress={() => setFilter({ tour: undefined, hotel: undefined })}
              />
            </View>
          ) : null}
          <View style={styles.filters}>
            {withKinds && !itemFilter ? (
              <SegmentedControl
                label="Kind"
                options={[
                  { value: '', label: 'All' },
                  ...modules.map((module) => ({
                    value: KIND_OF_MODULE[module],
                    label: `${KIND_LABELS[KIND_OF_MODULE[module]]}s`,
                  })),
                ]}
                value={filters.kind ?? ''}
                onChange={(value) => setFilter({ kind: (value || undefined) as ReviewKind | undefined })}
              />
            ) : null}
            <SegmentedControl
              label="Visibility"
              options={VISIBILITY}
              value={filters.hidden ?? ''}
              onChange={(value) => setFilter({ hidden: value || undefined })}
            />
            <SegmentedControl
              label="Replies"
              options={REPLIED}
              value={filters.replied ?? ''}
              onChange={(value) => setFilter({ replied: value || undefined })}
            />
            <View style={styles.rating}>
              <SelectField
                label="Rating"
                options={RATINGS}
                value={filters.rating ?? ''}
                onChange={(value) => setFilter({ rating: value || undefined })}
              />
            </View>
          </View>
          {reviews.isPending ? (
            <LoadingState />
          ) : reviews.isError ? (
            <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
          ) : reviews.data.results.length === 0 ? (
            <EmptyState
              icon="star-outline"
              title={filtered ? 'No matching reviews' : 'No reviews yet'}
              message={
                filtered
                  ? 'No reviews match these filters.'
                  : 'Customers can review their trips once they are over. Their reviews appear here.'
              }
            />
          ) : isWide ? (
            <Table columns={columns}>
              {reviews.data.results.map((review) => {
                const item = itemTitle(review);
                return (
                  <TableRow
                    key={review.id}
                    columns={columns}
                    selected={review.id === selected}
                    onPress={() => open(review.id)}
                    accessibilityLabel={`${review.rating} stars, ${item.primary}, ${review.customer.full_name}, ${statusWords(review)}`}
                    cells={[
                      <Stars key="stars" value={review.rating} />,
                      ...(withKinds ? [KIND_LABELS[review.kind]] : []),
                      <TwoLineCell key="item" primary={item.primary} secondary={item.secondary} />,
                      <TwoLineCell
                        key="customer"
                        primary={review.customer.full_name}
                        secondary={review.customer.email}
                      />,
                      <Text key="comment" style={styles.text} numberOfLines={1}>
                        {firstLine(review.comment)}
                      </Text>,
                      formatDay(review.created_at),
                      <ReviewChips key="status" review={review} />,
                    ]}
                  />
                );
              })}
            </Table>
          ) : (
            <View style={styles.cards}>
              {reviews.data.results.map((review) => {
                const item = itemTitle(review);
                return (
                  <Card key={review.id} selected={review.id === selected}>
                    <View style={styles.between}>
                      <Stars value={review.rating} size={16} />
                      <Text style={styles.muted}>{formatDay(review.created_at)}</Text>
                    </View>
                    <Text style={styles.strong}>
                      {item.primary}
                      {item.secondary ? ` · ${item.secondary}` : ''}
                    </Text>
                    <Text style={styles.muted}>{review.customer.full_name}</Text>
                    {review.comment ? (
                      <Text style={styles.text} numberOfLines={2}>
                        {review.comment}
                      </Text>
                    ) : null}
                    <ReviewChips review={review} />
                    <View style={styles.start}>
                      <Button title="Open" variant="secondary" onPress={() => open(review.id)} />
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
          {reviews.data ? <Pagination page={page} count={reviews.data.count} onChange={setPage} /> : null}
        </Screen>
      }
    />
  );
}

function ReviewChips({ review }: { review: AdminReview }) {
  if (!review.reply && !review.is_hidden) {
    return null;
  }
  return (
    <View style={styles.chips}>
      {review.reply ? <StatusChip label="Replied" tone="success" /> : null}
      {review.is_hidden ? <StatusChip label="Hidden" tone="neutral" /> : null}
    </View>
  );
}

type DetailProps = {
  id: string;
  onOpenBooking: (review: AdminReview) => void;
  onOpenCustomer: (id: string) => void;
};

function AdminReviewDetailView({ id, onOpenBooking, onOpenCustomer }: DetailProps) {
  const review = useQuery({
    queryKey: ['admin', 'reviews', 'detail', id],
    queryFn: async () => (await api.get<AdminReview>(`/admin/reviews/${id}`)).data,
  });
  if (review.isPending) {
    return <LoadingState />;
  }
  if (review.isError) {
    return <DetailError error={review.error} onRetry={() => review.refetch()} notFound="Review not found" />;
  }
  return <ReviewDetail review={review.data} onOpenBooking={onOpenBooking} onOpenCustomer={onOpenCustomer} />;
}

function ReviewDetail({ review, onOpenBooking, onOpenCustomer }: Omit<DetailProps, 'id'> & { review: AdminReview }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(review.reply);
  const updated = (data: AdminReview) => {
    queryClient.setQueryData(['admin', 'reviews', 'detail', review.id], data);
    return queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] });
  };
  const visibility = useMutation({
    mutationFn: async (action: 'hide' | 'show') =>
      (await api.post<AdminReview>(`/admin/reviews/${review.id}/${action}`)).data,
    onSuccess: updated,
  });
  const saveReply = useMutation({
    mutationFn: async (text: string) =>
      (await api.post<AdminReview>(`/admin/reviews/${review.id}/reply`, { reply: text })).data,
    onSuccess: (data) => {
      setReply(data.reply);
      return updated(data);
    },
  });
  const item = itemTitle(review);
  const bookingLabel = {
    flight: 'Open the flight booking',
    tour: 'Open the tour booking',
    hotel: 'Open the hotel booking',
  }[review.kind];

  return (
    <>
      <Card>
        <View style={styles.between}>
          <Stars value={review.rating} size={22} />
          <ReviewChips review={review} />
        </View>
        <Text style={styles.heading}>
          {item.primary}
          {item.secondary ? ` · ${item.secondary}` : ''}
        </Text>
        {review.kind === 'flight' ? <Text style={styles.muted}>{FLIGHT_REVIEW_NOTE}</Text> : null}
        <Text style={styles.muted}>
          Written {formatDateTime(review.created_at)}
          {review.updated_at !== review.created_at ? ` · edited ${formatDateTime(review.updated_at)}` : ''}
        </Text>
        <Text style={styles.text}>{review.comment || 'No comment.'}</Text>
      </Card>

      <Card>
        <Text style={styles.section}>Customer and booking</Text>
        <Text style={styles.strong}>{review.customer.full_name}</Text>
        <Text style={styles.text}>{review.customer.email}</Text>
        <Text style={styles.muted}>Shown publicly as “{review.reviewer_name}”</Text>
        <View style={styles.actions}>
          <Button title={bookingLabel} variant="link" onPress={() => onOpenBooking(review)} />
          <Button title="Open the customer" variant="link" onPress={() => onOpenCustomer(review.customer.id)} />
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Visibility</Text>
        <Text style={styles.text}>
          {review.is_hidden
            ? `Hidden${review.hidden_by ? ` by ${review.hidden_by}` : ''}${review.hidden_at ? ` on ${formatDay(review.hidden_at)}` : ''}. Its text, name and reply are not shown publicly, but its rating still counts. The customer still sees it, marked as hidden.`
            : 'Shown publicly with the customer’s first name and initial.'}
        </Text>
        <FormError message={visibility.isError ? errorMessage(visibility.error) : null} />
        <View style={styles.start}>
          <Button
            title={review.is_hidden ? 'Show' : 'Hide'}
            variant={review.is_hidden ? 'primary' : 'secondary'}
            icon={review.is_hidden ? 'eye-outline' : 'eye-off-outline'}
            onPress={() => visibility.mutate(review.is_hidden ? 'show' : 'hide')}
            loading={visibility.isPending}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Your reply</Text>
        <Text style={styles.muted}>
          {review.reply && review.replied_at
            ? `Posted ${formatDateTime(review.replied_at)}${review.replied_by ? ` by ${review.replied_by}` : ''}. `
            : ''}
          One public reply, shown under the review{review.is_hidden ? ' once it is shown again' : ''}.
        </Text>
        <TextField
          label="Reply"
          value={reply}
          onChangeText={setReply}
          multiline
          numberOfLines={4}
          maxLength={2000}
          placeholder="Thank the customer, or explain what you are doing about it."
        />
        <FormError message={saveReply.isError ? errorMessage(saveReply.error) : null} />
        <View style={styles.actions}>
          <Button
            title="Save reply"
            onPress={() => saveReply.mutate(reply)}
            loading={saveReply.isPending && saveReply.variables !== ''}
            disabled={!reply.trim() || reply.trim() === review.reply || saveReply.isPending}
          />
          {review.reply ? (
            <Button
              title="Remove reply"
              variant="danger"
              onPress={() => saveReply.mutate('')}
              loading={saveReply.isPending && saveReply.variables === ''}
              disabled={saveReply.isPending}
            />
          ) : null}
        </View>
      </Card>
    </>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md },
  rating: { minWidth: 160 },
  itemFilter: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  cards: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  start: { alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
