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
          Account: 'account',
        },
      },
      OfferingDetail: {
        path: 'offerings/:id',
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
          AdminOfferings: 'offerings',
          AdminRequests: 'requests',
        },
      },
      AdminOfferingNew: 'admin/offerings/new',
      AdminOfferingEdit: {
        path: 'admin/offerings/:id',
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
    },
  },
};
