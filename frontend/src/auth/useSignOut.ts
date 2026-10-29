import { useCallback } from 'react';

import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from './AuthContext';

/** Logs out and leaves for the guest start screen in the same update. */
export function useSignOut() {
  const { user, logout } = useAuth();
  return useCallback(() => {
    // Admins switch navigators, which opens the guest start screen by itself.
    if (user?.role !== 'admin') {
      navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
    logout();
  }, [user, logout]);
}
