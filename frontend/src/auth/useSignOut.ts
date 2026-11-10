import { CommonActions } from '@react-navigation/native';
import { useCallback, useEffect } from 'react';

import { IS_PLATFORM } from '../config';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from './AuthContext';
import { toLogin } from './gate';
import { requestLoginAfterSignOut, takeLoginAfterSignOut } from './loginRedirect';
import { takePendingPath } from './pendingAction';

/** Logs out; every area then shows its own sign-in page (/login on the agency's or the platform's host). */
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

/**
 * In the root navigator: once signed out, opens the sign-in page. It runs after the navigators of the signed-out
 * app have mounted (an admin's or the owner's sign-out swaps the whole navigator), so the reset lands in them.
 */
export function useLoginAfterSignOut(signedIn: boolean) {
  useEffect(() => {
    if (signedIn || !navigationRef.isReady() || !takeLoginAfterSignOut()) {
      return;
    }
    // The page signed out from may have asked to be reopened after sign-in (signed-in-only pages do when they see
    // a signed-out visitor); after a sign-out the next sign-in starts at the area's home instead.
    takePendingPath();
    // Sign-in alone on the platform, so signing in again opens the dashboard (not the page underneath).
    navigationRef.dispatch(
      IS_PLATFORM ? CommonActions.reset({ index: 0, routes: [{ name: 'PlatformLogin' }] }) : toLogin,
    );
  }, [signedIn]);
}
