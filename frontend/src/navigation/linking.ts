import { LinkingOptions } from '@react-navigation/native';

import { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          Explore: '',
          Requests: 'requests',
          Bookings: 'bookings',
          Account: 'account',
        },
      },
      OfferDetail: {
        path: 'offers/:id',
        parse: { id: Number, query: Number },
      },
      BookingNew: {
        path: 'offers/:offer/book',
        parse: { offer: Number, query: Number },
      },
      BookingDetail: {
        path: 'bookings/:id',
        parse: { id: Number },
      },
      QueryNew: 'requests/new',
      QueryDetail: {
        path: 'requests/:id',
        parse: { id: Number },
      },
      Login: {
        path: 'login',
        parse: { passwordReset: (value: string) => value === 'true' },
      },
      Register: 'register',
      ForgotPassword: 'forgot-password',
      ResetPassword: 'reset-password',
      AdminTabs: {
        path: 'admin',
        screens: {
          AdminDashboard: '',
          AdminOffers: 'offers',
          AdminRequests: 'requests',
          AdminBookings: 'bookings',
          AdminSettings: 'settings',
        },
      },
      AdminOfferNew: 'admin/offers/new',
      AdminOfferEdit: {
        path: 'admin/offers/:id',
        parse: { id: Number },
      },
      AdminQueryDetail: {
        path: 'admin/requests/:id',
        parse: { id: Number },
      },
      AdminQueryRespond: {
        path: 'admin/requests/:id/respond',
        parse: { id: Number },
      },
      AdminBookingDetail: {
        path: 'admin/bookings/:id',
        parse: { id: Number },
      },
    },
  },
};
