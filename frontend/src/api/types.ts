/** 'owner' is the system owner signed in on the platform (the platform API itself has no roles). */
export type Role = 'customer' | 'admin' | 'owner';

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

export type TripType = 'one_way' | 'return';

/** A fare condition for refunds or changes. */
export type Policy = 'not_allowed' | 'with_fee' | 'free';

export type Direction = 'outbound' | 'return';

/** One flight. Dates and times ("HH:MM") are local to the airport concerned. */
export type Segment = {
  airline: Airline;
  flight_number: string;
  /** Set only for a codeshare. */
  operating_airline: Airline | null;
  origin: Airport;
  destination: Airport;
  departure_date: string;
  departure_time: string;
  arrival_date: string;
  arrival_time: string;
};

/** The wait between two flights of one direction: a layover under 24 hours, a stopover from 24 hours. */
export type Connection = {
  airport: Airport;
  wait_minutes: number;
  kind: 'layover' | 'stopover';
};

export type ItineraryDirection = {
  /** In flight order. */
  segments: Segment[];
  connections: Connection[];
  stop_count: number;
};

export type Itinerary = { outbound: ItineraryDirection; return: ItineraryDirection | null };

/** Trip type, baggage per passenger and fare conditions: an offer's, or a booking's own copy. */
export type Trip = {
  trip_type: TripType;
  /** The first return flight's date; null for one way. */
  return_date: string | null;
  checked_bags: number;
  /** Null when not stated. */
  checked_bag_kg: number | null;
  cabin_bag_kg: number | null;
  refund_policy: Policy;
  change_policy: Policy;
  itinerary: Itinerary;
};

export type Offer = Trip & {
  id: string;
  origin: Airport;
  destination: Airport;
  departure_date: string;
  ticket_class: TicketClass;
  /** Per person; for a return trip, the round trip. */
  price: string;
  /** The ticketing airline. */
  airline: Airline;
  valid_until: string;
  is_bookable: boolean;
  /** gds: published from a fare search. */
  source: OfferSource;
  /** When the provider last priced a GDS offer; null for manual offers. */
  price_checked_at: string | null;
};

export type OfferSource = 'manual' | 'gds';

export type FareType = 'public' | 'private' | 'unknown';

/** What a GDS offer was published from; all null for manual offers. */
export type OfferGdsFields = {
  integration: { id: string; name: string } | null;
  route: string | null;
  provider_ref: string | null;
  fare_key: string | null;
  /** The provider's amount for one adult, in net_currency. */
  net_amount: string | null;
  net_currency: string | null;
  net_usd: string | null;
  /** Units of net_currency per US dollar. */
  rate: string | null;
  rate_date: string | null;
  fare_type: FareType | null;
  /** Set while the route's searches no longer find the flights (review-mode routes). */
  missing_since: string | null;
};

export type AdminOffer = Offer &
  OfferGdsFields & {
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
  /** Empty for any. */
  trip_type: TripType | '';
  return_date: string | null;
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

/** A segment as recorded in a booking's changes, already readable. */
export type SegmentChange = { direction: Direction; flight: string; route: string; departure: string; arrival: string };

/** Only the keys that changed are present. */
export type BookingChanges = {
  unit_price?: { old: string; new: string };
  /** Ticketing airline names. */
  airline?: { old: string; new: string };
  segments?: { old: SegmentChange[]; new: SegmentChange[] };
};

/** The trip fields and itinerary are the booking's own, copied from the offer when it was booked. */
export type Booking = Trip & {
  id: string;
  offer: Offer;
  /** The booking's own ticketing airline: the offer's when booked, changed only by confirming with changes. */
  airline: Airline;
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

export type AdminBooking = Booking & {
  user: User;
  /** Copied from the offer when booked; integration and fare_key are null for manual offers. */
  source: OfferSource;
  integration: { id: string; name: string } | null;
  fare_key: string | null;
};

/** A flight as the API takes it: airline ids, airport codes, local dates and "HH:MM" times. */
export type SegmentInput = {
  direction: Direction;
  airline: string;
  flight_number: string;
  operating_airline: string | null;
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  arrival_date: string;
  arrival_time: string;
};

/** A fare found by re-checking a booking, priced now; the USD fields are null (and no_rate true) without a rate. */
export type CheckedFare = {
  fare_key: string;
  /** The ticketing airline. */
  airline: Airline;
  ticket_class: TicketClass;
  net_amount: string;
  net_currency: string;
  net_usd: string | null;
  rate: string | null;
  rate_date: string | null;
  no_rate: boolean;
  /** USD with the route's markup. */
  selling_price: string | null;
  /** In the shape confirm-availability takes. */
  segments: SegmentInput[];
  itinerary: Itinerary;
};

/** found: the booked flights' current price in fare; otherwise the cheapest others on the same dates. */
export type FareRecheck = { found: boolean; fare: CheckedFare | null; alternatives: CheckedFare[] };

export type AdminBookingDetail = AdminBooking & { events: BookingEvent[]; boarding_passes: BoardingPass[] };

export type Dashboard = {
  open_queries: number;
  bookings_requested: number;
  bookings_awaiting_payment: number;
  bookings_paid_awaiting_boarding_pass: number;
  /** Fares picked by a search, waiting to be published or dismissed. */
  new_fares: number;
};

export type AppSettings = {
  payment_instructions: string;
  payment_hold_hours: number;
  reminder_hours_before: number;
  admin_notification_email: string;
};

export type AdminCustomer = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
};

/** A domain (hostname) that reaches an agency; the primary one is used in email links. */
export type TenantDomain = {
  id: string;
  domain: string;
  is_primary: boolean;
};

/** An agency as the system owner manages it on the platform. */
export type Tenant = {
  id: string;
  name: string;
  /** The address typed when it was created: <slug>.<base domain>. */
  slug: string;
  primary_domain: string | null;
  is_active: boolean;
  suspension_reason: '' | 'manual' | 'non_payment';
  suspended_at: string | null;
  /** Where invoices are sent. */
  billing_email: string;
  /** Fare searches allowed per calendar month. */
  monthly_search_allowance: number;
  searches_this_month: number;
  created_at: string;
};

export type TenantDetail = Tenant & { domains: TenantDomain[] };

export type PlanKind = 'subscription' | 'support';
export type BillingCycle = 'monthly' | 'annual';

export type PlanTag = '' | 'recommended' | 'basic' | 'advanced';

/** What agencies pay the platform for. Prices are decimals as strings, in the platform's currency. */
export type Plan = {
  id: string;
  name: string;
  kind: PlanKind;
  /** Its place on the plans page (subscription plans only). */
  tag: PlanTag;
  /** Sanitized HTML. */
  description: string;
  monthly_price: string | null;
  annual_price: string | null;
  currency: string;
  is_active: boolean;
  created_at: string;
};

export type Subscription = {
  id: string;
  plan: { id: string; name: string; kind: PlanKind };
  kind: PlanKind;
  billing_cycle: BillingCycle;
  price: string | null;
  currency: string;
  started_on: string;
  next_period_start: string;
  ended_on: string | null;
  created_at: string;
};

export type InvoiceStatus = 'unpaid' | 'paid' | 'void';

/** An invoice as an agency's admins see it. */
export type AgencyInvoice = {
  id: string;
  number: string;
  plan_name: string;
  billing_cycle: BillingCycle;
  period_start: string;
  period_end: string;
  amount: string;
  currency: string;
  issued_on: string;
  due_on: string;
  status: InvoiceStatus;
  paid_on: string | null;
  /** Unpaid and past its due date. */
  overdue: boolean;
};

/** An invoice as the system owner sees it. */
export type Invoice = AgencyInvoice & {
  tenant: { id: string; name: string };
  subscription: string;
  suspension_waived: boolean;
  /** The first day the agency can be suspended for it; null once paid, void or waived. */
  suspends_on: string | null;
  created_at: string;
};

export type PlatformSettings = {
  issuer_details: string;
  payment_instructions: string;
  invoice_due_days: number;
  invoice_lead_days: number;
  billing_contact_email: string;
  /** Notified of new chats and messages on the platform's desk. */
  support_email: string;
  currency: string;
};

/** The agency's own billing, for its admins. */
export type AgencyBilling = {
  subscriptions: {
    plan_name: string;
    kind: PlanKind;
    billing_cycle: BillingCycle;
    price: string | null;
    currency: string;
    next_period_start: string;
  }[];
  billing_contact_email: string;
  overdue: { number: string; amount: string; currency: string; due_on: string; suspends_on: string } | null;
};

/** The system owner's dashboard; amounts are decimals as strings in the platform's currency. */
export type PlatformDashboard = {
  currency: string;
  agencies: { total: number; active: number; suspended: number; non_payment: number; no_plan: number };
  revenue: { this_month: string; this_year: string; all_time: string };
  recurring: { monthly_value: string; subscriptions: number; support: number };
  outstanding: { count: number; total: string; overdue_count: number; overdue_total: string };
  /** The last 12 months, oldest first; month is "YYYY-MM". */
  revenue_by_month: { month: string; total: string }[];
  plans: { id: string; name: string; kind: PlanKind; agencies: number }[];
  attention: {
    id: string;
    number: string;
    tenant: { id: string; name: string };
    amount: string;
    due_on: string;
    suspends_on: string | null;
  }[];
  /** This month's fare searches of each agency that made any, most used first. */
  fare_searches: { tenant: { id: string; name: string }; used: number; allowance: number }[];
};

export type PublicPlan = Pick<
  Plan,
  'id' | 'name' | 'kind' | 'tag' | 'description' | 'monthly_price' | 'annual_price' | 'currency'
>;

export type PublicPlans = { plans: PublicPlan[]; billing_contact_email: string };

export type AgencyPlans = PublicPlans & { current_plan_ids: string[] };

/** A support chat message; attachments open through /support/attachments/<id>. */
export type ChatMessage = {
  id: string;
  from_staff: boolean;
  author_name: string;
  body: string;
  has_attachment: boolean;
  attachment_name: string;
  created_at: string;
};

export type ChatStatus = 'open' | 'closed';

/** A support chat as the person who wrote in sees it. */
export type Chat = {
  id: string;
  subject: string;
  email: string;
  status: ChatStatus;
  last_message_at: string;
  /** The desk's latest message is unseen. */
  unread: boolean;
  closed_at: string | null;
  created_at: string;
};

export type ChatDetail = Chat & { messages: ChatMessage[] };

/** A support chat as the desk sees it. */
export type DeskChat = Chat & {
  name: string;
  /** A guest's chat: a single message, replies go by email only. */
  is_guest: boolean;
  closed_by_name: string | null;
  /** Platform desk: the agency an agency admin wrote from. */
  agency: { id: string; name: string } | null;
};

export type DeskChatDetail = DeskChat & { messages: ChatMessage[] };

/** A connection to a fare provider. Its credentials are written only, never returned. */
export type Integration = {
  id: string;
  provider: 'duffel' | 'travelport';
  name: string;
  mode: 'test' | 'live';
  is_active: boolean;
  last_tested_at: string | null;
  /** Null until tested (again after new credentials). */
  last_test_ok: boolean | null;
  last_test_message: string;
  created_at: string;
};

/** skipped: a scheduled run that could not start; the reason is in errors. */
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export type SearchRun = {
  id: string;
  route: string;
  /** recheck: one search for a booking's fare; it stores no fares. */
  trigger: 'manual' | 'scheduled' | 'recheck';
  date_from: string;
  date_to: string;
  status: RunStatus;
  searches_made: number;
  fares_found: number;
  /** Provider errors and skipped results, as short messages. */
  errors: string[];
  started_by: string | null;
  created_at: string;
  finished_at: string | null;
};

export type RouteSchedule = 'manual' | 'daily' | 'weekly';

/** A route the agency searches; 0 is Monday in weekdays. */
export type Route = {
  id: string;
  origin: Airport;
  destination: Airport;
  trip_type: TripType;
  /** Return trips: nights between departure and return. */
  stay_nights: number | null;
  ticket_class: TicketClass;
  /** Per direction; null for any. */
  max_connections: number | null;
  /** Ticketing airlines to keep; empty for any. */
  airlines: Airline[];
  /** Empty for every active integration. */
  integrations: { id: string; name: string; provider: string; is_active: boolean }[];
  weekdays: number[];
  pick_cheapest: boolean;
  pick_cheapest_direct: boolean;
  max_per_date: number;
  markup_percent: string;
  markup_fixed: string;
  schedule: RouteSchedule;
  /** Weekly schedules: the day it runs, 0 = Monday. */
  schedule_weekday: number | null;
  /** fixed: window_from to window_to; rolling: days_ahead_from to days_ahead_to days after the day it runs. */
  window: 'fixed' | 'rolling';
  window_from: string | null;
  window_to: string | null;
  days_ahead_from: number | null;
  days_ahead_to: number | null;
  /** Publishes picked fares at once; its offers follow every search. */
  auto_publish: boolean;
  is_active: boolean;
  created_at: string;
  last_run: SearchRun | null;
  /** Picked fares waiting for review. */
  new_fares: number;
};

export type SearchUsage = { allowance: number; used: number; left: number };

export type FareStatus = 'new' | 'published' | 'dismissed';

/** A fare a search found. Amounts in USD are null (and no_rate true) when its currency had no rate. */
export type Fare = Omit<Trip, 'return_date'> & {
  id: string;
  route: string;
  run: string;
  integration: { id: string; name: string; provider: string; is_active: boolean };
  ticket_class: TicketClass;
  airline: Airline;
  departure_date: string;
  return_date: string | null;
  net_amount: string;
  net_currency: string;
  net_usd: string | null;
  rate: string | null;
  rate_date: string | null;
  no_rate: boolean;
  selling_price: string | null;
  fare_type: FareType;
  seats_left: number | null;
  provider_ref: string;
  fare_key: string;
  expires_at: string | null;
  picked: boolean;
  status: FareStatus;
  /** The offer it was published as. */
  offer: string | null;
  created_at: string;
};

export type FareList = { run: SearchRun | null; dates: { departure_date: string; fares: Fare[] }[] };

/** The cheapest fare of one run for a departure date. */
export type FareHistoryPoint = {
  run: string;
  searched_at: string;
  net_usd: string;
  net_amount: string;
  net_currency: string;
};

/** Units of a currency per US dollar on a date. */
export type ExchangeRate = {
  id: string;
  currency: string;
  units_per_usd: string;
  date: string;
  source: 'feed' | 'manual';
  fetched_at: string;
  /** More than three days old. */
  stale: boolean;
};

/** GET /agency: the agency at an address; code is what customers type in the app. */
export type AgencyInfo = {
  code: string;
  name: string;
  app_address: string;
};
