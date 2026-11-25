import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { errorMessage, firstMessage } from '../api/errors';
import { DocumentType, Gender, Traveller, TravellerInput } from '../api/types';
import { colors, createStyles, font, space, weight } from '../theme';
import { formatDate } from '../utils/format';
import { Button } from './Button';
import { DateField } from './DateField';
import { Dialog } from './Dialog';
import { FieldGrid } from './Field';
import { FLAG_CODES } from './flagCodes';
import { SelectField } from './SelectField';
import { Stepper } from './Stepper';
import { TextField } from './TextField';

/** The form's values: every field as text, as typed. */
export type TravellerDraft = {
  full_name: string;
  gender: Gender;
  date_of_birth: string;
  nationality: string;
  document_type: DocumentType;
  document_number: string;
  document_expiry: string;
  email: string;
  phone: string;
  checked_bags: number;
  checked_bag_kg: string;
  cabin_bag_kg: string;
  special_requests: string;
};

export type TravellerErrors = Partial<Record<keyof TravellerDraft, string>>;

const FIELDS: (keyof TravellerDraft)[] = [
  'full_name',
  'gender',
  'date_of_birth',
  'nationality',
  'document_type',
  'document_number',
  'document_expiry',
  'email',
  'phone',
  'checked_bags',
  'checked_bag_kg',
  'cabin_bag_kg',
  'special_requests',
];

export const MAX_CHECKED_BAGS = 5;

export function emptyTraveller(): TravellerDraft {
  return {
    full_name: '',
    gender: '',
    date_of_birth: '',
    nationality: '',
    document_type: '',
    document_number: '',
    document_expiry: '',
    email: '',
    phone: '',
    checked_bags: 0,
    checked_bag_kg: '',
    cabin_bag_kg: '',
    special_requests: '',
  };
}

export function travellerDraft(traveller: Traveller): TravellerDraft {
  return {
    ...traveller,
    date_of_birth: traveller.date_of_birth ?? '',
    document_expiry: traveller.document_expiry ?? '',
    checked_bag_kg: traveller.checked_bag_kg?.toString() ?? '',
    cabin_bag_kg: traveller.cabin_bag_kg?.toString() ?? '',
  };
}

export function travellerInput(draft: TravellerDraft): TravellerInput {
  const kg = (value: string) => (value.trim() ? Number(value) : null);
  return {
    ...draft,
    full_name: draft.full_name.trim(),
    date_of_birth: draft.date_of_birth || null,
    document_number: draft.document_number.trim(),
    document_expiry: draft.document_expiry || null,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    checked_bag_kg: kg(draft.checked_bag_kg),
    cabin_bag_kg: kg(draft.cabin_bag_kg),
    special_requests: draft.special_requests.trim(),
  };
}

const KG = /^\d{1,3}$/;

/** Mirrors the server's rules; empty when the draft is fine. */
export function validateTraveller(draft: TravellerDraft): TravellerErrors {
  const errors: TravellerErrors = {};
  const name = draft.full_name.trim();
  if (name.length < 2 || name.length > 100) {
    errors.full_name = 'Enter the full name as on the travel document.';
  }
  const number = draft.document_number.trim();
  if (number && !draft.document_type) {
    errors.document_type = 'Choose the document type.';
  }
  if (number.length > 30) {
    errors.document_number = 'At most 30 characters.';
  }
  if (draft.document_expiry && !number) {
    errors.document_number = 'Enter the document number with its expiry.';
  }
  if (number && draft.document_type === 'passport' && !draft.document_expiry) {
    errors.document_expiry = "Enter the passport's expiry date.";
  }
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  for (const field of ['checked_bag_kg', 'cabin_bag_kg'] as const) {
    const value = draft[field].trim();
    if (value && (!KG.test(value) || Number(value) < 1 || Number(value) > 100)) {
      errors[field] = 'Kilograms from 1 to 100.';
    }
  }
  if (draft.special_requests.trim().length > 500) {
    errors.special_requests = 'At most 500 characters.';
  }
  return errors;
}

/** Field errors from a refused save; nested is the path into the error body, e.g. ["lines", 0, "travellers", 1]. */
export function travellerServerErrors(error: unknown, nested: (string | number)[] = []): TravellerErrors | null {
  let body: unknown = isAxiosError(error) ? error.response?.data : undefined;
  for (const key of nested) {
    body = body && typeof body === 'object' ? (body as Record<string | number, unknown>)[key] : undefined;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const errors: TravellerErrors = {};
  for (const field of FIELDS) {
    const message = firstMessage((body as Record<string, unknown>)[field]);
    if (message) {
      errors[field] = message;
    }
  }
  return Object.keys(errors).length ? errors : null;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Countries by name, from the bundled flags' two-letter codes. */
const COUNTRIES = [...FLAG_CODES]
  .filter((code) => code.length === 2)
  .map((code) => ({ value: code.toUpperCase(), label: regionNames.of(code.toUpperCase()) ?? code.toUpperCase() }))
  .filter((country) => country.label !== country.value)
  .sort((a, b) => a.label.localeCompare(b.label));

const GENDERS: { value: Gender; label: string }[] = [
  { value: '', label: 'Not stated' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
];

export function countryName(code: string): string {
  return COUNTRIES.find((country) => country.value === code)?.label ?? code;
}

type FieldsProps = {
  value: TravellerDraft;
  onChange: (value: TravellerDraft) => void;
  errors: TravellerErrors;
  /** Names this traveller in the inputs' accessible labels when a page has several, e.g. "Traveller 2". */
  name?: string;
};

/** The shared traveller form: full name required, everything else optional. */
export function TravellerFields({ value, onChange, errors, name }: FieldsProps) {
  const set = <K extends keyof TravellerDraft>(field: K, next: TravellerDraft[K]) =>
    onChange({ ...value, [field]: next });
  const a11y = (label: string) => (name ? `${name} ${label.toLowerCase()}` : label);
  return (
    <View style={styles.fields}>
      <TextField
        label="Full name (as on the travel document)"
        accessibilityLabel={a11y('Full name')}
        value={value.full_name}
        onChangeText={(text) => set('full_name', text)}
        error={errors.full_name}
        maxLength={100}
      />
      <FieldGrid>
        <SelectField
          label="Gender"
          accessibilityLabel={a11y('Gender')}
          options={GENDERS}
          value={value.gender}
          onChange={(next) => set('gender', next)}
          error={errors.gender}
        />
        <DateField
          label="Date of birth"
          accessibilityLabel={a11y('Date of birth')}
          value={value.date_of_birth}
          onChange={(next) => set('date_of_birth', next)}
          error={errors.date_of_birth}
        />
        <SelectField
          label="Nationality"
          accessibilityLabel={a11y('Nationality')}
          options={[{ value: '', label: 'Not stated' }, ...COUNTRIES]}
          value={value.nationality}
          onChange={(next) => set('nationality', next)}
          error={errors.nationality}
        />
      </FieldGrid>
      <FieldGrid>
        <SelectField
          label="Document"
          accessibilityLabel={a11y('Document type')}
          options={DOCUMENT_TYPES}
          value={value.document_type}
          onChange={(next) => set('document_type', next)}
          error={errors.document_type}
        />
        <TextField
          label="Document number"
          accessibilityLabel={a11y('Document number')}
          value={value.document_number}
          onChangeText={(text) => set('document_number', text)}
          error={errors.document_number}
          autoCapitalize="characters"
          maxLength={30}
        />
        <DateField
          label={value.document_type === 'national_id' ? 'Expiry (optional)' : 'Expiry'}
          accessibilityLabel={a11y('Document expiry')}
          value={value.document_expiry}
          onChange={(next) => set('document_expiry', next)}
          error={errors.document_expiry}
        />
      </FieldGrid>
      <FieldGrid>
        <TextField
          label="Email"
          accessibilityLabel={a11y('Email')}
          value={value.email}
          onChangeText={(text) => set('email', text)}
          error={errors.email}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextField
          label="Phone"
          accessibilityLabel={a11y('Phone')}
          value={value.phone}
          onChangeText={(text) => set('phone', text)}
          error={errors.phone}
          keyboardType="phone-pad"
          maxLength={30}
        />
      </FieldGrid>
      <FieldGrid>
        <Stepper
          label="Checked bags"
          value={value.checked_bags}
          min={0}
          max={MAX_CHECKED_BAGS}
          onChange={(next) => set('checked_bags', next)}
          decreaseLabel={a11y('Remove a checked bag')}
          increaseLabel={a11y('Add a checked bag')}
          error={errors.checked_bags}
        />
        <TextField
          label="Kg per checked bag"
          accessibilityLabel={a11y('Kg per checked bag')}
          value={value.checked_bag_kg}
          onChangeText={(text) => set('checked_bag_kg', text)}
          error={errors.checked_bag_kg}
          keyboardType="number-pad"
          placeholder="Not stated"
        />
        <TextField
          label="Cabin bag kg"
          accessibilityLabel={a11y('Cabin bag kg')}
          value={value.cabin_bag_kg}
          onChangeText={(text) => set('cabin_bag_kg', text)}
          error={errors.cabin_bag_kg}
          keyboardType="number-pad"
          placeholder="Not stated"
        />
      </FieldGrid>
      <TextField
        label="Special requests (diet, medical, accessibility)"
        accessibilityLabel={a11y('Special requests')}
        value={value.special_requests}
        onChangeText={(text) => set('special_requests', text)}
        error={errors.special_requests}
        multiline
        numberOfLines={2}
        maxLength={500}
      />
    </View>
  );
}

type DialogProps = {
  title: string;
  initial: TravellerDraft;
  onSave: (input: TravellerInput) => Promise<unknown>;
  onClose: () => void;
};

/** Adds or edits one traveller; open it by rendering it. */
export function TravellerDialog({ title, initial, onSave, onClose }: DialogProps) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<TravellerErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const found = validateTraveller(draft);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      return;
    }
    setSaving(true);
    try {
      await onSave(travellerInput(draft));
      onClose();
    } catch (error) {
      const fields = travellerServerErrors(error);
      if (fields) {
        setErrors(fields);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={title}
      size="large"
      onClose={onClose}
      busy={saving}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Save traveller" onPress={save} loading={saving} />
        </>
      }
    >
      <TravellerFields value={draft} onChange={setDraft} errors={errors} />
    </Dialog>
  );
}

/** One traveller's details as a short summary; full adds documents and contact details (admins and the booker). */
export function TravellerSummary({ traveller }: { traveller: Traveller }) {
  const facts = [
    traveller.gender === 'female' ? 'Female' : traveller.gender === 'male' ? 'Male' : '',
    traveller.date_of_birth ? `Born ${formatDate(traveller.date_of_birth)}` : '',
    traveller.nationality ? countryName(traveller.nationality) : '',
    traveller.document_number
      ? `${traveller.document_type === 'passport' ? 'Passport' : 'National ID'} ${traveller.document_number}` +
        (traveller.document_expiry ? `, expires ${formatDate(traveller.document_expiry)}` : '')
      : '',
    traveller.email,
    traveller.phone,
    traveller.checked_bags
      ? `${traveller.checked_bags} checked bag${traveller.checked_bags === 1 ? '' : 's'}` +
        (traveller.checked_bag_kg ? ` × ${traveller.checked_bag_kg} kg` : '')
      : '',
    traveller.cabin_bag_kg ? `Cabin bag ${traveller.cabin_bag_kg} kg` : '',
  ].filter(Boolean);
  return (
    <View style={styles.summary}>
      <Text style={styles.name}>{traveller.full_name}</Text>
      {facts.length ? <Text style={styles.muted}>{facts.join(' · ')}</Text> : null}
      {traveller.special_requests ? <Text style={styles.muted}>Requests: {traveller.special_requests}</Text> : null}
    </View>
  );
}

const styles = createStyles(() => ({
  fields: { gap: space.md },
  summary: { gap: 2, flexShrink: 1, minWidth: 0 },
  name: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
}));
