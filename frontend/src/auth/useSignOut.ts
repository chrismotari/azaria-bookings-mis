import { useCallback } from 'react';

import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from './AuthContext';

/** Logs out and returns to Explore in the same update. */
export function useSignOut() {
  const { user, logout } = useAuth();
  return useCallback(() => {
    // Admins and the platform owner switch navigators, which opens their first screen by itself.
    if (user?.role === 'customer') {
      navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
    logout();
  }, [user, logout]);
}
