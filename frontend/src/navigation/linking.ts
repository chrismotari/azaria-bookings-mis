import { LinkingOptions } from '@react-navigation/native';

import { IS_PLATFORM } from '../config';
import { RootStackParamList } from './types';

const agencyLinking: LinkingOptions<RootStackParamList> = {
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
          BookingNew: 'offers/:offer/book',
          QueryNew: 'requests/new',
          Support: 'account/support/:id?',
        },
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
          AdminOffers: 'offers/:id?',
          AdminRequests: 'requests/:id?',
          AdminBookings: 'bookings/:id?',
          AdminUsers: 'users/:id?',
          AdminChats: 'chats/:id?',
          AdminSettings: 'settings',
          AdminOfferNew: 'offers/new',
          AdminQueryRespond: 'requests/:id/respond',
          AdminBilling: 'billing',
          AdminPlans: 'plans',
        },
      },
    },
  },
};

/** The root host: the system owner's screens only. */
const platformLinking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      // '/' is the public introduction; the owner's screens have their own paths.
      PlatformHome: '',
      PlatformPricing: 'pricing',
      PlatformLogin: 'login',
      PlatformTabs: {
        screens: {
          PlatformDashboard: 'dashboard',
          PlatformAgencies: 'agencies/:id?',
          PlatformPlans: 'plans',
          PlatformInvoices: 'invoices/:id?',
          PlatformSettings: 'settings',
        },
      },
    },
  },
};

export const linking = IS_PLATFORM ? platformLinking : agencyLinking;
