import { createNavigationContainerRef } from '@react-navigation/native';

import { NavigationTarget, RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateTo(target: NavigationTarget) {
  (navigationRef.navigate as (screen: string, params?: object) => void)(target.screen, target.params);
}
