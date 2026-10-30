export type Role = 'customer' | 'admin';

export type User = {
  id: number;
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
  id: number;
  code: string;
  name: string;
  city: string;
  country: string;
};

export type TicketClass = 'economy' | 'premium_economy' | 'business' | 'first';

export const TICKET_CLASSES: { value: TicketClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

export type Offer = {
  id: number;
  origin: Airport;
  destination: Airport;
  departure_date: string;
  ticket_class: TicketClass;
  price: string;
  stopovers: number;
  airline: string;
  valid_until: string;
  is_bookable: boolean;
};

export type AdminOffer = Offer & {
  is_public: boolean;
  is_active: boolean;
  created_at: string;
};

export type QueryStatus = 'open' | 'responded' | 'closed';

export type QueryResponse = {
  id: number;
  message: string;
  offers: Offer[];
  created_at: string;
};

export type Query = {
  id: number;
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
  | 'expired';

export type BookingEvent = {
  id: number;
  from_status: BookingStatus | '';
  to_status: BookingStatus;
  created_at: string;
};

export type Booking = {
  id: number;
  offer: Offer;
  query: number | null;
  passenger_count: number;
  notes: string;
  unit_price: string;
  total_price: string;
  status: BookingStatus;
  payment_deadline: string | null;
  created_at: string;
};

export type BoardingPass = {
  id: number;
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
