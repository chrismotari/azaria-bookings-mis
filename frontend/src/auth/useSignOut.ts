import { CommonActions } from '@react-navigation/native';
import { useCallback, useEffect } from 'react';

import { IS_PLATFORM } from '../config';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from './AuthContext';
import { toLogin } from './gate';
import { requestLoginAfterSignOut, takeLoginAfterSignOut } from './loginRedirect';
import { takePendingPath } from './pendingAction';

export function useSignOut() {
  const { user, logout } = useAuth();
  return useCallback(() => {
    // Off any signed-in-only screen first, so it does not remember itself as the page to reopen after sign-in.
    if (user?.role === 'customer') {
      navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
    requestLoginAfterSignOut();
    logout();
  }, [user, logout]);
}

// Used in the root navigator so it runs after the signed-out navigators have mounted (an admin's or the owner's
// sign-out swaps the whole navigator) and the reset lands in them.
export function useLoginAfterSignOut(signedIn: boolean) {
  useEffect(() => {
    if (signedIn || !navigationRef.isReady() || !takeLoginAfterSignOut()) {
      return;
    }
    // A signed-in-only page may have asked to be reopened after sign-in; after a sign-out, start at home instead.
    takePendingPath();
    // Sign-in alone on the platform, so signing in again opens the dashboard rather than the page underneath.
    navigationRef.dispatch(
      IS_PLATFORM ? CommonActions.reset({ index: 0, routes: [{ name: 'PlatformLogin' }] }) : toLogin,
    );
  }, [signedIn]);
}
