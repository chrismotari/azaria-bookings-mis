import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAgencyInfo } from '../agency/GetAppScreen';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { OwnReview, PublicReview, PublicReviews, Rating, ReviewKind } from '../api/types';
import { colors, createStyles, font, radius, space, weight } from '../theme';
import { formatDay } from '../utils/format';
import { Button } from './Button';
import { Card } from './Card';
import { useConfirm } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { FormError } from './Field';
import { Icon } from './Icon';
import { PressState } from './pressState';
import { StatusChip } from './StatusChip';
import { ErrorState, LoadingState } from './StatusViews';
import { TextField } from './TextField';

export const FLIGHT_REVIEW_NOTE =
  'Rate how we handled your booking: our service, not the airline or the flight itself.';

const LEVELS = [5, 4, 3, 2, 1] as const;

export function reviewsLabel(count: number): string {
  return `${count} review${count === 1 ? '' : 's'}`;
}

/** Filled, half and empty stars for a rating out of five. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessible accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Icon
          key={star}
          name={value >= star ? 'star' : value >= star - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color={colors.accent}
        />
      ))}
    </View>
  );
}

/** "★ 4.6 (12)" under a card's title; nothing without reviews. */
export function RatingLine({ rating }: { rating: Rating | null | undefined }) {
  if (!rating) {
    return null;
  }
  return (
    <View
      style={styles.line}
      accessible
      accessibilityLabel={`Rated ${rating.average} out of 5, ${reviewsLabel(rating.count)}`}
    >
      <Icon name="star" size={14} color={colors.accent} />
      <Text style={styles.lineStrong}>{rating.average.toFixed(1)}</Text>
      <Text style={styles.muted}>({rating.count})</Text>
    </View>
  );
}

/** On admin tour and hotel pages: the rating, with a link to its reviews. */
export function AdminRatingLink({ rating, onPress }: { rating: Rating | null; onPress: () => void }) {
  if (!rating) {
    return <Text style={styles.muted}>No reviews yet</Text>;
  }
  return (
    <View style={styles.line}>
      <Stars value={rating.average} />
      <Text style={styles.lineStrong}>{rating.average.toFixed(1)}</Text>
      <Button title={`${reviewsLabel(rating.count)}: see all`} variant="link" onPress={onPress} />
    </View>
  );
}

type Scope = { tour: string } | { hotel: string } | { kind: 'flight' };

/** The average, the count and a bar per star level, then the visible reviews ten at a time. */
export function ReviewsSection({ scope }: { scope: Scope }) {
  const agency = useAgencyInfo();
  const reviews = useInfiniteQuery({
    queryKey: ['reviews', scope],
    queryFn: async ({ pageParam }) =>
      (await api.get<PublicReviews>('/reviews', { params: { ...scope, page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });

  if (reviews.isPending) {
    return <LoadingState />;
  }
  if (reviews.isError) {
    return <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />;
  }
  const summary = reviews.data.pages[0].summary;
  if (!summary.count || summary.average === null) {
    return <Text style={styles.muted}>No reviews yet</Text>;
  }
  const shown = reviews.data.pages.flatMap((page) => page.results);
  const largest = Math.max(...LEVELS.map((level) => summary.by_rating[level]));
  return (
    <View style={styles.section}>
      <View style={styles.summary}>
        <View style={styles.average}>
          <Text style={styles.averageNumber}>{summary.average.toFixed(1)}</Text>
          <Stars value={summary.average} size={18} />
          <Text style={styles.muted}>{reviewsLabel(summary.count)}</Text>
        </View>
        <View style={styles.bars}>
          {LEVELS.map((level) => {
            const count = summary.by_rating[level];
            return (
              <View
                key={level}
                style={styles.barRow}
                accessible
                accessibilityLabel={`${level} star${level === 1 ? '' : 's'}: ${count}`}
              >
                <Text style={styles.barLabel}>{level}</Text>
                <Icon name="star" size={12} color={colors.accent} />
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${largest ? (count / largest) * 100 : 0}%` }]} />
                </View>
                <Text style={styles.barCount}>{count}</Text>
              </View>
            );
          })}
        </View>
      </View>
      {shown.map((review) => (
        <ReviewItem key={review.id} review={review} agencyName={agency.data?.name} />
      ))}
      {reviews.hasNextPage ? (
        <View style={styles.start}>
          <Button
            title="Show more"
            variant="secondary"
            onPress={() => reviews.fetchNextPage()}
            loading={reviews.isFetchingNextPage}
          />
        </View>
      ) : null}
    </View>
  );
}

function ReviewItem({ review, agencyName }: { review: PublicReview; agencyName: string | undefined }) {
  return (
    <View style={styles.review}>
      <View style={styles.reviewHeader}>
        <Stars value={review.rating} />
        <Text style={styles.strong}>{review.reviewer_name}</Text>
        <Text style={styles.muted}>{formatDay(review.created_at)}</Text>
      </View>
      {review.comment ? <Text style={styles.text}>{review.comment}</Text> : null}
      {review.reply ? <Reply reply={review.reply} agencyName={agencyName} /> : null}
    </View>
  );
}

function Reply({ reply, agencyName }: { reply: string; agencyName: string | undefined }) {
  return (
    <View style={styles.reply}>
      <Text style={styles.replyTitle}>Response from {agencyName ?? 'the agency'}</Text>
      <Text style={styles.text}>{reply}</Text>
    </View>
  );
}

/** Reviews of a tour or hotel, in a card under its description. */
export function ReviewsCard({ scope }: { scope: { tour: string } | { hotel: string } }) {
  return (
    <Card>
      <Text style={styles.heading}>Reviews</Text>
      <ReviewsSection scope={scope} />
    </Card>
  );
}

/** "Flight booking service ★ 4.8 (40 reviews)", opening the flight reviews; nothing without reviews. */
export function FlightServiceRating({ rating }: { rating: Rating | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!rating) {
    return null;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Flight booking service rated ${rating.average} out of 5, ${reviewsLabel(rating.count)}`}
        onPress={() => setOpen(true)}
        style={({ hovered }: PressState) => [styles.service, hovered && styles.serviceHovered]}
      >
        <Text style={styles.text}>Flight booking service</Text>
        <Icon name="star" size={14} color={colors.accent} />
        <Text style={styles.lineStrong}>{rating.average.toFixed(1)}</Text>
        <Text style={styles.link}>({reviewsLabel(rating.count)})</Text>
      </Pressable>
      <Dialog
        open={open}
        title="How customers rate our flight booking service"
        size="large"
        onClose={() => setOpen(false)}
        footer={<Button title="Close" variant="secondary" onPress={() => setOpen(false)} />}
      >
        <ReviewsSection scope={{ kind: 'flight' }} />
      </Dialog>
    </>
  );
}

/** Five tappable stars; 0 is none chosen. */
function StarInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.stars} role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          role="radio"
          aria-checked={value === star}
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
          onPress={() => onChange(star)}
          style={({ hovered }: PressState) => [styles.starButton, hovered && styles.serviceHovered]}
        >
          <Icon name={value >= star ? 'star' : 'star-outline'} size={32} color={colors.accent} />
        </Pressable>
      ))}
    </View>
  );
}

type ReviewCardProps = {
  kind: ReviewKind;
  bookingId: string;
  canReview: boolean | undefined;
  review: OwnReview | null | undefined;
  /** The bookings' query key prefix, refreshed after a change, e.g. ['tour-bookings']. */
  bookingsKey: string[];
};

const BOOKING_FIELD: Record<ReviewKind, string> = { flight: 'booking', tour: 'tour_booking', hotel: 'hotel_booking' };

/** "Rate your trip" while the booking can be reviewed; then the customer's review with Edit and Delete. */
export function ReviewCard({ kind, bookingId, canReview, review, bookingsKey }: ReviewCardProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const agency = useAgencyInfo();
  const [editing, setEditing] = useState(false);
  const refresh = () =>
    Promise.all(
      [bookingsKey, ['reviews'], ['tours'], ['hotels'], ['offers']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  const remove = useMutation({
    mutationFn: () => api.delete(`/reviews/${review?.id}`),
    onSuccess: refresh,
  });

  if (!review && !canReview) {
    return null;
  }
  const note = kind === 'flight' ? <Text style={styles.muted}>{FLIGHT_REVIEW_NOTE}</Text> : null;
  if (!review || editing) {
    return (
      <Card>
        <Text style={styles.heading}>{review ? 'Edit your review' : 'Rate your trip'}</Text>
        {note}
        <ReviewForm
          review={review ?? null}
          onSave={async (values) => {
            if (review) {
              await api.patch(`/reviews/${review.id}`, values);
            } else {
              await api.post('/reviews', { [BOOKING_FIELD[kind]]: bookingId, ...values });
            }
            await refresh();
            setEditing(false);
          }}
          onCancel={review ? () => setEditing(false) : undefined}
        />
      </Card>
    );
  }
  const onDelete = async () => {
    if (
      await confirm({
        title: 'Delete your review?',
        message: review.reply
          ? 'Your rating, comment and the agency’s response are removed. You can review this trip again later.'
          : 'Your rating and comment are removed. You can review this trip again later.',
        confirmLabel: 'Delete review',
        tone: 'danger',
      })
    ) {
      remove.mutate();
    }
  };
  return (
    <Card>
      <View style={styles.reviewHeader}>
        <Text style={styles.heading}>Your review</Text>
        {review.is_hidden ? <StatusChip label="Hidden by the agency" tone="neutral" /> : null}
      </View>
      {note}
      <View style={styles.reviewHeader}>
        <Stars value={review.rating} size={18} />
        <Text style={styles.muted}>{formatDay(review.created_at)}</Text>
      </View>
      {review.comment ? <Text style={styles.text}>{review.comment}</Text> : null}
      {review.reply ? <Reply reply={review.reply} agencyName={agency.data?.name} /> : null}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      <View style={styles.actions}>
        <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
        <Button title="Delete" variant="danger" onPress={onDelete} loading={remove.isPending} />
      </View>
    </Card>
  );
}

type FormValues = { rating: number; comment: string };

function ReviewForm({
  review,
  onSave,
  onCancel,
}: {
  review: OwnReview | null;
  onSave: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!rating) {
      setError('Choose from one to five stars.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ rating, comment: comment.trim() });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <StarInput value={rating} onChange={setRating} />
      <TextField
        label="Comment (optional)"
        placeholder="What went well, and what could be better?"
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={4}
        maxLength={2000}
      />
      <FormError message={error} />
      <View style={styles.actions}>
        <Button title={review ? 'Save review' : 'Submit'} onPress={submit} loading={saving} />
        {onCancel ? <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} /> : null}
      </View>
    </>
  );
}

const styles = createStyles(() => ({
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  starButton: { padding: 2, borderRadius: radius.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  lineStrong: { fontSize: font.small, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  link: { fontSize: font.small, color: colors.primary, textDecorationLine: 'underline' },
  section: { gap: space.lg },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xl },
  average: { alignItems: 'center', gap: space.xs, minWidth: 110 },
  averageNumber: { fontSize: 40, fontWeight: weight.heavy, color: colors.text, lineHeight: 44 },
  bars: { flexGrow: 1, flexBasis: 200, gap: space.xs },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  barLabel: { width: 10, fontSize: font.small, color: colors.text, textAlign: 'right' },
  barTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.background, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
  barCount: { width: 28, fontSize: font.small, color: colors.muted },
  review: { gap: space.xs, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  reply: {
    marginLeft: space.lg,
    marginTop: space.xs,
    padding: space.md,
    gap: space.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.sm,
  },
  replyTitle: { fontSize: font.small, fontWeight: weight.bold, color: colors.text },
  start: { alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  service: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.sm,
  },
  serviceHovered: { backgroundColor: colors.background },
}));
