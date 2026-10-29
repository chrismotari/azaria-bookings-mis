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

export type MainTabParamList = {
  Explore: undefined;
  Requests: undefined;
  Bookings: undefined;
  Account: undefined;
};

export type AdminTabParamList = {
  AdminDashboard: undefined;
  AdminOfferings: undefined;
  AdminRequests: { status?: QueryStatus | 'all' } | undefined;
  AdminBookings: { status?: BookingStatus | 'all' } | undefined;
  AdminSettings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  /** query: the request whose response led here; passed on to the booking. */
  OfferingDetail: { id: number; query?: number };
  BookingNew: { offering: number; query?: number };
  BookingDetail: { id: number };
  QueryNew: QueryPrefill | undefined;
  QueryDetail: { id: number };
  Login: { passwordReset?: boolean } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { uid?: string; token?: string } | undefined;
  AdminTabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  AdminOfferingNew: undefined;
  AdminOfferingEdit: { id: number };
  AdminQueryDetail: { id: number };
  AdminQueryRespond: { id: number };
  AdminBookingDetail: { id: number };
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
