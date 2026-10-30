import { LinkingOptions } from '@react-navigation/native';

import { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          // Explore is the offers list; '/' opens it too.
          Explore: { path: 'offers/:id?', alias: [''], parse: { id: Number, query: Number } },
          Requests: { path: 'requests/:id?', parse: { id: Number } },
          Bookings: { path: 'bookings/:id?', parse: { id: Number } },
          Account: 'account',
        },
      },
      BookingNew: {
        path: 'offers/:offer/book',
        parse: { offer: Number, query: Number },
      },
      QueryNew: 'requests/new',
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
          AdminOffers: { path: 'offers/:id?', parse: { id: Number } },
          AdminRequests: { path: 'requests/:id?', parse: { id: Number } },
          AdminBookings: { path: 'bookings/:id?', parse: { id: Number } },
          AdminSettings: 'settings',
        },
      },
      AdminOfferNew: 'admin/offers/new',
      AdminQueryRespond: {
        path: 'admin/requests/:id/respond',
        parse: { id: Number },
      },
    },
  },
};
