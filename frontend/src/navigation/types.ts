import { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Explore: undefined;
  Account: undefined;
};

export type AdminTabParamList = {
  AdminOfferings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  OfferingDetail: { id: number };
  Login: { passwordReset?: boolean } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { uid?: string; token?: string } | undefined;
  AdminTabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  AdminOfferingNew: undefined;
  AdminOfferingEdit: { id: number };
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
