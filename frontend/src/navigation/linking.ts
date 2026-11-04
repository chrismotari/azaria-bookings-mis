import { LinkingOptions } from '@react-navigation/native';

import { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          // Explore is the offers list; '/' opens it too.
          Explore: { path: 'offers/:id?', alias: [''] },
          Requests: 'requests/:id?',
          Bookings: 'bookings/:id?',
          Account: 'account',
        },
      },
      BookingNew: 'offers/:offer/book',
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
          AdminOffers: 'offers/:id?',
          AdminRequests: 'requests/:id?',
          AdminBookings: 'bookings/:id?',
          AdminUsers: 'users/:id?',
          AdminSettings: 'settings',
        },
      },
      AdminOfferNew: 'admin/offers/new',
      AdminQueryRespond: 'admin/requests/:id/respond',
    },
  },
};
