import { NavigatorScreenParams } from '@react-navigation/native';

import { BookingStatus, QueryStatus, TicketClass } from '../api/types';

/** Prefilled request-for-options criteria (airports as IATA codes), e.g. from Explore's filters. */
export type QueryPrefill = {
  origin?: string;
  destination?: string;
  date_from?: string;
  date_to?: string;
  price_min?: string;
  price_max?: string;
  ticket_class?: TicketClass;
  max_stopovers?: string;
};

/** id: the item whose detail is open beside (wide) or instead of (narrow) the list. */
export type MainTabParamList = {
  /** query: the request whose response led to this offer; passed on to the booking. */
  Explore: { id?: string; query?: string } | undefined;
  Requests: { id?: string } | undefined;
  Bookings: { id?: string } | undefined;
  Account: undefined;
  /** Not in the bar: shown under Requests and Explore. */
  QueryNew: QueryPrefill | undefined;
  BookingNew: { offer: string; query?: string };
  /** Account > Support: the customer's chats. */
  Support: { id?: string } | undefined;
};

export type AdminTabParamList = {
  AdminDashboard: undefined;
  AdminOffers: { id?: string } | undefined;
  AdminRequests: { status?: QueryStatus | 'all'; id?: string } | undefined;
  AdminBookings: { status?: BookingStatus | 'all'; id?: string } | undefined;
  AdminUsers: { id?: string } | undefined;
  /** The desk: chats from the site's visitors and customers. */
  AdminChats: { id?: string } | undefined;
  AdminSettings: undefined;
  /** Not in the bar: shown under Offers and Requests. */
  AdminOfferNew: undefined;
  AdminQueryRespond: { id: string };
  /** Not in the bar: opened from Settings, shown under it. */
  AdminBilling: undefined;
  AdminPlans: undefined;
  /** Settings > Support: the agency's chats with the platform. */
  AdminSupport: { id?: string } | undefined;
};

/** The platform's screens (root host only). */
export type AgencyStatusFilter = 'all' | 'active' | 'suspended';
export type InvoiceStatusFilter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'void';

export type PlatformTabParamList = {
  PlatformDashboard: undefined;
  PlatformAgencies: { status?: AgencyStatusFilter; id?: string } | undefined;
  PlatformPlans: undefined;
  PlatformInvoices: { status?: InvoiceStatusFilter; id?: string } | undefined;
  /** The platform's desk: chats from visitors and agencies' admins. */
  PlatformChats: { id?: string } | undefined;
  PlatformSettings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Login: { passwordReset?: boolean } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { uid?: string; token?: string } | undefined;
  AdminTabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  PlatformHome: undefined;
  PlatformPricing: undefined;
  PlatformLogin: undefined;
  PlatformTabs: NavigatorScreenParams<PlatformTabParamList> | undefined;
};

/** A screen and its params, e.g. what a guest was trying to open before signing in. */
export type NavigationTarget = {
  [K in keyof RootStackParamList]: { screen: K; params?: RootStackParamList[K] };
}[keyof RootStackParamList];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
