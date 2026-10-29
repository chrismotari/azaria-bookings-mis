import { useCallback } from 'react';

import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from './AuthContext';

/** Logs out and returns to Explore in the same update. */
export function useSignOut() {
  const { user, logout } = useAuth();
  return useCallback(() => {
    // Admins switch navigators, which opens Explore by itself.
    if (user?.role !== 'admin') {
      navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
    logout();
  }, [user, logout]);
}
