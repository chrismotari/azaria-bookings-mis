import { NavigatorScreenParams } from '@react-navigation/native';

import {
  BookingStatus,
  HotelBookingStatus,
  Module,
  QueryStatus,
  ReviewKind,
  TicketClass,
  TripType,
} from '../api/types';

/** Prefilled request-for-options criteria (airports as IATA codes), e.g. from Explore's filters. */
export type QueryPrefill = {
  origin?: string;
  destination?: string;
  date_from?: string;
  date_to?: string;
  trip_type?: TripType;
  return_date?: string;
  price_min?: string;
  price_max?: string;
  ticket_class?: TicketClass;
  max_stopovers?: string;
};

/** id: the item whose detail is open beside (wide) or instead of (narrow) the list. */
export type MainTabParamList = {
  /** query: the request whose response led to this offer; passed on to the booking. tab: the module switch's tab,
   * with more than one module. */
  Explore: { id?: string; query?: string; tab?: 'all' | Module } | undefined;
  Requests: { id?: string } | undefined;
  /** id: a flight booking; tour: a tour booking (booked: just made, shows "You're booked"); hotel: a hotel
   * booking. */
  Bookings: { id?: string; tour?: string; hotel?: string; booked?: 'yes' } | undefined;
  Account: undefined;
  /** Not in the bar: shown under Requests and Explore. */
  QueryNew: QueryPrefill | undefined;
  BookingNew: { offer: string; query?: string };
  /** Not in the bar: under Explore. */
  TourDetail: { id: string };
  TourBook: { id: string };
  /** Not in the bar: under Explore. The stay and guests, when chosen, price the rooms. */
  HotelDetail: HotelStay & { id: string };
  /** rooms: the rates picked, one id per room, comma-separated. */
  HotelBook: HotelStay & { id: string; rooms?: string };
  /** Account > Support: the customer's chats. */
  Support: { id?: string } | undefined;
};

export type AdminTabParamList = {
  AdminDashboard: undefined;
  AdminOffers: { id?: string } | undefined;
  /** Shown only once the agency has an integration. */
  AdminRoutes: { id?: string } | undefined;
  AdminRequests: { status?: QueryStatus | 'all'; id?: string } | undefined;
  AdminBookings: { status?: BookingStatus | 'all'; id?: string } | undefined;
  /** role admin: the System admins list instead of the customers. */
  AdminUsers: { id?: string; role?: 'admin' } | undefined;
  /** The desk: chats from the site's visitors and customers. */
  AdminChats: { id?: string } | undefined;
  AdminSettings: undefined;
  /** booking: a tour booking, opened from the tour. */
  AdminTours: { id?: string; booking?: string; status?: AdminTourFilter } | undefined;
  /** Not in the bar: shown under Tours. customer: who the admin books for. */
  AdminTourNew: undefined;
  AdminTourEdit: { id: string };
  AdminTourBook: { id: string; customer: string };
  /** tab hotels: the hotels list (id a hotel); otherwise the bookings (id a booking). */
  AdminHotels: { tab?: 'hotels'; id?: string; status?: HotelBookingStatus | 'all' } | undefined;
  /** id: a review; the filters as the list takes them. */
  AdminReviews: (AdminReviewFilters & { id?: string }) | undefined;
  /** Not in the bar: shown under Hotels. customer: who the admin books for. */
  AdminHotelNew: undefined;
  AdminHotelEdit: { id: string };
  AdminHotelBook: { id: string; customer: string };
  /** Not in the bar: shown under Offers and Requests. */
  AdminOfferNew: undefined;
  AdminQueryRespond: { id: string };
  /** Not in the bar: a route's fares, under Routes. run: a run other than the latest. */
  AdminFares: { route: string; run?: string };
  /** Not in the bar: opened from Settings, shown under it. */
  AdminBilling: undefined;
  AdminPlans: undefined;
  /** Settings > Support: the agency's chats with the platform. */
  AdminSupport: { id?: string } | undefined;
};

/** A hotel stay and its guests as URL params. */
export type HotelStay = { check_in?: string; check_out?: string; adults?: string; children?: string };

/** hidden and replied: "true" or "false"; rating: "1" to "5". */
export type AdminReviewFilters = {
  kind?: ReviewKind;
  tour?: string;
  hotel?: string;
  rating?: string;
  hidden?: string;
  replied?: string;
};

export type AdminTourFilter = 'all' | 'upcoming' | 'past' | 'inactive' | 'cancelled';

export type AgencyStatusFilter = 'all' | 'active' | 'suspended';
export type InvoiceStatusFilter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'void';

/** Root host only. */
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
  /** Web only: the agency's "Get the app" page. */
  GetApp: undefined;
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
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
