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

/** A domain (hostname) that reaches an agency; the primary one is used in email links. */
export type TenantDomain = {
  id: number;
  domain: string;
  is_primary: boolean;
};

/** An agency as the system owner manages it on the platform. */
export type Tenant = {
  id: number;
  name: string;
  /** The address typed when it was created: <slug>.<base domain>. */
  slug: string;
  primary_domain: string | null;
  is_active: boolean;
  suspension_reason: '' | 'manual' | 'non_payment';
  suspended_at: string | null;
  /** Where invoices are sent. */
  billing_email: string;
  created_at: string;
};

export type TenantDetail = Tenant & { domains: TenantDomain[] };

export type PlanKind = 'subscription' | 'support';
export type BillingCycle = 'monthly' | 'annual';

/** What agencies pay the platform for. Prices are decimals as strings, in the platform's currency. */
export type PlanTag = '' | 'recommended' | 'basic' | 'advanced';

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
  tenant: { id: number; name: string };
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
    tenant: { id: number; name: string };
    amount: string;
    due_on: string;
    suspends_on: string | null;
  }[];
};

/** A plan as the plans pages show it. */
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
};

export type DeskChatDetail = DeskChat & { messages: ChatMessage[] };
