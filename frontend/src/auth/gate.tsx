import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { ReactNode, useCallback } from 'react';

import { User } from '../api/types';
import { navigateTo, navigationRef } from '../navigation/navigationRef';
import { NavigationTarget } from '../navigation/types';
import { useAuth } from './AuthContext';
import { setPendingAction, takePendingAction } from './pendingAction';

const toLogin = CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] });

/**
 * The auth gate. Wraps a login-required screen: a guest who opens it has the target
 * remembered and is sent to Login, and returns to it after signing in.
 */
export function RequireAuth({ target, children }: { target: NavigationTarget; children: ReactNode }) {
  const { user } = useAuth();
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setPendingAction(target);
        // Dispatched through the screen's own navigator (and bubbled up to the root),
        // which works on the first render, before the container ref is ready.
        navigation.dispatch(toLogin);
      }
      // The target is rebuilt on every render; only a change of user matters here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, navigation]),
  );
  return user ? children : null;
}

/** After login or registration: customers continue to the stored action, if any. */
export function continueAfterSignIn(user: User) {
  // Admins get their own navigator, which opens on its first screen.
  if (user.role === 'admin') {
    return;
  }
  const target = takePendingAction();
  navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
  if (target) {
    navigateTo(target);
  }
}
