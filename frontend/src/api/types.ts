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

export type Offering = {
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

export type AdminOffering = Offering & {
  is_public: boolean;
  is_active: boolean;
  created_at: string;
};

export type QueryStatus = 'open' | 'responded' | 'closed';

export type QueryResponse = {
  id: number;
  message: string;
  offerings: Offering[];
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
