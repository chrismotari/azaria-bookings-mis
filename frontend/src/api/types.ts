export type Role = 'customer' | 'admin';

export type User = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: Role;
};

export type AuthResponse = {
  access: string;
  refresh: string;
  user: User;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type Airport = {
  id: string;
  code: string;
  name: string;
  city: string;
  country: string;
  /** ISO 3166-1 alpha-2, e.g. "KE"; may be empty. */
  country_code: string;
};

/** From the shared airline list; logo_url is absolute, or null without a logo. */
export type Airline = {
  id: string;
  iata_code: string;
  name: string;
  logo_url: string | null;
};

export type TicketClass = 'economy' | 'premium_economy' | 'business' | 'first';

export const TICKET_CLASSES: { value: TicketClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

/** A stop between origin and destination: a layover under 24 hours, a stopover from 24 hours. */
export type Stop = {
  airport: Airport;
  duration_minutes: number;
  kind: 'layover' | 'stopover';
};

export type Offer = {
  id: string;
  origin: Airport;
  destination: Airport;
  departure_date: string;
  ticket_class: TicketClass;
  price: string;
  airline: Airline;
  valid_until: string;
  is_bookable: boolean;
  /** In flight order. */
  stops: Stop[];
  stop_count: number;
};

export type AdminOffer = Offer & {
  is_public: boolean;
  is_active: boolean;
  created_at: string;
};

export type QueryStatus = 'open' | 'responded' | 'closed';

export type QueryResponse = {
  id: string;
  message: string;
  offers: Offer[];
  created_at: string;
};

export type Query = {
  id: string;
  origin: Airport | null;
  destination: Airport | null;
  date_from: string;
  date_to: string | null;
  price_min: string | null;
  price_max: string | null;
  ticket_class: TicketClass | '';
  max_stopovers: number | null;
  message: string;
  status: QueryStatus;
  created_at: string;
};

export type QueryDetail = Query & { responses: QueryResponse[] };

export type AdminQuery = Query & { user: User };

export type AdminQueryDetail = AdminQuery & { responses: QueryResponse[] };

export type BookingStatus =
  | 'requested'
  | 'availability_confirmed'
  | 'paid'
  | 'completed'
  | 'unavailable'
  | 'cancelled'
  | 'expired'
  | 'declined';

export type BookingEvent = {
  id: string;
  from_status: BookingStatus | '';
  to_status: BookingStatus;
  created_at: string;
};

/** A stop as recorded in booking changes. */
export type StopChange = { code: string; city: string; duration_minutes: number };

/** Only the keys that changed are present. */
export type BookingChanges = {
  unit_price?: { old: string; new: string };
  stops?: { old: StopChange[]; new: StopChange[] };
};

export type Booking = {
  id: string;
  offer: Offer;
  query: string | null;
  passenger_count: number;
  notes: string;
  unit_price: string;
  total_price: string;
  status: BookingStatus;
  payment_deadline: string | null;
  /** What the admin changed when confirming availability; null when nothing changed. */
  changes: BookingChanges | null;
  changes_accepted: boolean;
  /** The request holding options suggested when the booking was marked unavailable. */
  alternatives: string | null;
  created_at: string;
  /** The booking's own stops, copied from the offer when it was booked. */
  stops: Stop[];
  stop_count: number;
};

export type BoardingPass = {
  id: string;
  original_name: string;
  uploaded_at: string;
};

export type BookingDetail = Booking & {
  events: BookingEvent[];
  /** Set only while the booking is availability_confirmed. */
  payment_instructions: string | null;
  /** Present only once the booking is completed. */
  boarding_passes?: BoardingPass[];
};

export type AdminBooking = Booking & { user: User };

export type AdminBookingDetail = AdminBooking & { events: BookingEvent[]; boarding_passes: BoardingPass[] };

export type Dashboard = {
  open_queries: number;
  bookings_requested: number;
  bookings_awaiting_payment: number;
  bookings_paid_awaiting_boarding_pass: number;
};

export type AppSettings = {
  payment_instructions: string;
  payment_hold_hours: number;
  reminder_hours_before: number;
  admin_notification_email: string;
};

/** A customer as the admin manages them. */
export type AdminCustomer = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
};
