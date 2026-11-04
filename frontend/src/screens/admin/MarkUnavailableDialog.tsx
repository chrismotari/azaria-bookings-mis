import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminBookingDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormSection } from '../../components/FormSection';
import { OfferFilterValues } from '../../components/OfferFilterFields';
import { colors, font } from '../../theme';
import { todayInNairobi } from '../../utils/format';
import { ChosenOffers, MessageField, OfferOptionsSections, useOfferOptions } from './OfferOptions';
import { OfferFormValues } from './offerSchema';

/** The existing-offer search starts from the booking's route and date. */
function initialFilters(booking: AdminBookingDetail): OfferFilterValues {
  const { origin, destination, departure_date } = booking.offer;
  return {
    origin: { text: origin.code, airport: origin },
    destination: { text: destination.code, airport: destination },
    date_from: departure_date,
    date_to: departure_date,
    price_min: '',
    price_max: '',
    ticket_class: '',
    max_stopovers: '',
  };
}

function customOfferDefaults(booking: AdminBookingDetail): OfferFormValues {
  const { offer } = booking;
  return {
    origin: offer.origin,
    destination: offer.destination,
    departure_date: offer.departure_date,
    ticket_class: offer.ticket_class,
    price: '',
    stops: [],
    airline: null,
    valid_until: todayInNairobi(),
    is_public: false,
  };
}

type Props = {
  booking: AdminBookingDetail;
  open: boolean;
  onClose: () => void;
  onDone: (booking: AdminBookingDetail) => void;
};

/** Mark the booking unavailable, optionally suggesting other offers to the customer. */
export function MarkUnavailableDialog({ booking, open, onClose, onDone }: Props) {
  // A fresh form each time the dialog opens.
  return open ? <MarkUnavailableForm booking={booking} onClose={onClose} onDone={onDone} /> : null;
}

function MarkUnavailableForm({ booking, onClose, onDone }: Omit<Props, 'open'>) {
  const options = useOfferOptions(initialFilters(booking), customOfferDefaults(booking));
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setFormError(null);
    setSaving(true);
    try {
      // Without suggestions the message has nowhere to go, so only the status changes.
      const body = options.count ? { message: message.trim(), ...options.body() } : {};
      const response = await api.post<AdminBookingDetail>(`/admin/bookings/${booking.id}/mark-unavailable`, body);
      onDone(response.data);
    } catch (error) {
      setFormError(options.applyErrors(error) ? 'Some custom offers need fixing.' : errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="Mark unavailable"
      size="large"
      onClose={onClose}
      busy={saving}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Mark unavailable" variant="danger" onPress={submit} loading={saving} />
        </>
      }
    >
      <Text style={styles.text}>
        The customer is told the seats are not available. This cannot be undone. You can also suggest other options:
        they reach the customer as an answered request they can book from.
      </Text>
      <OfferOptionsSections
        options={options}
        existingDescription="Active offers, starting from the booking's route and date."
        plain
      />
      <FormSection title="Suggested options" plain>
        <ChosenOffers options={options} />
        <MessageField value={message} onChange={setMessage} />
        <Text style={styles.muted}>
          {options.count
            ? `The customer is emailed ${options.count} suggested option${options.count === 1 ? '' : 's'} with your message.`
            : 'Choosing options is optional. Without any, the message is not sent.'}
        </Text>
      </FormSection>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
});
