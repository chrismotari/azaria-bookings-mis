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
  Explore: { id?: number; query?: number } | undefined;
  Requests: { id?: number } | undefined;
  Bookings: { id?: number } | undefined;
  Account: undefined;
};

export type AdminTabParamList = {
  AdminDashboard: undefined;
  AdminOffers: { id?: number } | undefined;
  AdminRequests: { status?: QueryStatus | 'all'; id?: number } | undefined;
  AdminBookings: { status?: BookingStatus | 'all'; id?: number } | undefined;
  AdminSettings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  BookingNew: { offer: number; query?: number };
  QueryNew: QueryPrefill | undefined;
  Login: { passwordReset?: boolean } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { uid?: string; token?: string } | undefined;
  AdminTabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  AdminOfferNew: undefined;
  AdminQueryRespond: { id: number };
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
