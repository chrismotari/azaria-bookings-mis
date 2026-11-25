import { createNavigationContainerRef } from '@react-navigation/native';

import { NavigationTarget, RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateTo(target: NavigationTarget) {
  (navigationRef.navigate as (screen: string, params?: object) => void)(target.screen, target.params);
}

/** The signed-in admin's dashboard, otherwise Explore. */
export function goHome() {
  if (!navigationRef.isReady()) {
    return;
  }
  if (!navigationRef.getRootState()?.routeNames.includes('Main')) {
    navigateTo({ screen: 'AdminTabs', params: { screen: 'AdminDashboard' } });
  } else {
    navigateTo({ screen: 'Main', params: { screen: 'Explore', params: {} } });
  }
}

type RootState = ReturnType<typeof navigationRef.getRootState>;

// Native: where the user was when the agency's theme changed, so the app re-mounts in the new colours right there.
let placeBeforeThemeChange: RootState | undefined;

export function rememberPlaceForThemeChange() {
  placeBeforeThemeChange = navigationRef.isReady() ? navigationRef.getRootState() : undefined;
}

/** The remembered place, once: the navigation's initial state when it mounts again. */
export function takePlaceBeforeThemeChange(): RootState | undefined {
  const place = placeBeforeThemeChange;
  placeBeforeThemeChange = undefined;
  return place;
}
