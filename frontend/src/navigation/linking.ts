import { LinkingOptions } from '@react-navigation/native';

import { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          Explore: '',
          Account: 'account',
        },
      },
      OfferingDetail: {
        path: 'offerings/:id',
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
        },
      },
      AdminOfferingNew: 'admin/offerings/new',
      AdminOfferingEdit: {
        path: 'admin/offerings/:id',
        parse: { id: Number },
      },
    },
  },
};
