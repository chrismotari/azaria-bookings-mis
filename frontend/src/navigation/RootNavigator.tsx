import { BottomTabScreenProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StackActions, useFocusEffect, useIsFocused, useLinkTo, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Fragment, ReactNode, useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { RequireAuth, toLogin } from '../auth/gate';
import { useLoginAfterSignOut } from '../auth/useSignOut';
import { setPendingPath, takePendingAction, takePendingPath } from '../auth/pendingAction';
import { Icon, IconName } from '../components/Icon';
import { AdminBookingsScreen } from '../screens/admin/AdminBookingsScreen';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { AdminOfferNewScreen } from '../screens/admin/AdminOfferFormScreen';
import { AdminOffersScreen } from '../screens/admin/AdminOffersScreen';
import { AdminQueryRespondScreen } from '../screens/admin/AdminQueryRespondScreen';
import { AdminRequestsScreen } from '../screens/admin/AdminRequestsScreen';
import { AdminSettingsScreen } from '../screens/admin/AdminSettingsScreen';
import { AdminUsersScreen } from '../screens/admin/AdminUsersScreen';
import { BookingNewScreen } from '../screens/bookings/BookingNewScreen';
import { BookingsScreen } from '../screens/bookings/BookingsScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { AccountScreen } from '../screens/customer/AccountScreen';
import { AdminBillingScreen, OverdueBanner } from '../screens/admin/AdminBillingScreen';
import { AdminPlansScreen } from '../screens/admin/AdminPlansScreen';
import { AgenciesScreen } from '../screens/platform/AgenciesScreen';
import { InvoicesScreen } from '../screens/platform/InvoicesScreen';
import { PlansScreen } from '../screens/platform/PlansScreen';
import { PlatformSettingsScreen } from '../screens/platform/PlatformSettingsScreen';
import { PlatformDashboardScreen } from '../screens/platform/PlatformDashboardScreen';
import { PlatformHomeScreen } from '../screens/platform/PlatformHomeScreen';
import { PlatformLoginScreen } from '../screens/platform/PlatformLoginScreen';
import { PlatformPricingScreen } from '../screens/platform/PlatformPricingScreen';
import { IS_PLATFORM } from '../config';
import { ExploreScreen } from '../screens/explore/ExploreScreen';
import { QueryNewScreen } from '../screens/requests/QueryNewScreen';
import { RequestsScreen } from '../screens/requests/RequestsScreen';
import { colors, useIsWide } from '../theme';
import { AppBar } from './AppBar';
import { PlatformPublicBar } from './PlatformPublicBar';
import { ResponsiveTabBar } from './ResponsiveTabBar';
import { AdminTabParamList, MainTabParamList, PlatformTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();
const AdminTabs = createBottomTabNavigator<AdminTabParamList>();
const PlatformTabs = createBottomTabNavigator<PlatformTabParamList>();

/**
 * An admin URL (e.g. the link in a new-booking email) opened while signed out: remember the path and sign in
 * first; AdminStack reopens it once the admin is signed in.
 */
function AdminSignInFirst() {
  const navigation = useNavigation();
  // Read on the first render, before the redirect changes the address.
  const path = useRef(Platform.OS === 'web' ? `${window.location.pathname}${window.location.search}` : null);
  useFocusEffect(
    useCallback(() => {
      if (path.current) {
        setPendingPath(path.current);
      }
      navigation.dispatch(toLogin);
    }, [navigation]),
  );
  return null;
}

/** The admin's screens; on sign-in it opens the admin page the admin was sent to before, if any. */
function AdminStack() {
  const linkTo = useLinkTo();
  useEffect(() => {
    // A customer action remembered before an admin signed in does not apply.
    takePendingAction();
    const path = takePendingPath();
    if (path) {
      linkTo(path);
    }
  }, [linkTo]);
  return (
    <View style={styles.fill}>
      {/* While an invoice to the platform is overdue, on every admin screen. */}
      <OverdueBanner />
      <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
        <Stack.Screen name="AdminTabs" component={AdminTabsNavigator} options={{ headerShown: false }} />
      </Stack.Navigator>
    </View>
  );
}

function GatedAccount() {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Account' } }}>
      <AccountScreen />
    </RequireAuth>
  );
}

function GatedRequests(props: BottomTabScreenProps<MainTabParamList, 'Requests'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Requests', params: props.route.params } }}>
      <RequestsScreen {...props} />
    </RequireAuth>
  );
}

/**
 * Form pages kept in a tab navigator would stay mounted, with whatever was typed last time; these are rebuilt each
 * time they open (and when opened again with other params, e.g. other prefilled criteria).
 */
function FreshEachVisit({ params, children }: { params: unknown; children: ReactNode }) {
  const focused = useIsFocused();
  return focused ? <Fragment key={JSON.stringify(params ?? {})}>{children}</Fragment> : null;
}

function GatedQueryNew(props: BottomTabScreenProps<MainTabParamList, 'QueryNew'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'QueryNew', params: props.route.params } }}>
      <FreshEachVisit params={props.route.params}>
        <QueryNewScreen {...props} />
      </FreshEachVisit>
    </RequireAuth>
  );
}

function FreshOfferNew(props: BottomTabScreenProps<AdminTabParamList, 'AdminOfferNew'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminOfferNewScreen />
    </FreshEachVisit>
  );
}

function FreshQueryRespond(props: BottomTabScreenProps<AdminTabParamList, 'AdminQueryRespond'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminQueryRespondScreen {...props} />
    </FreshEachVisit>
  );
}

function GatedBookings(props: BottomTabScreenProps<MainTabParamList, 'Bookings'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Bookings', params: props.route.params } }}>
      <BookingsScreen {...props} />
    </RequireAuth>
  );
}

function GatedBookingNew(props: BottomTabScreenProps<MainTabParamList, 'BookingNew'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'BookingNew', params: props.route.params } }}>
      <FreshEachVisit params={props.route.params}>
        <BookingNewScreen {...props} />
      </FreshEachVisit>
    </RequireAuth>
  );
}

// Login-required tabs, left out of the bar for guests.
const GATED_TABS: (keyof MainTabParamList)[] = ['Requests', 'Bookings', 'Account'];

// Form pages: never in the bar; the tab they belong to stays highlighted on them.
const MAIN_FORM_PAGES: (keyof MainTabParamList)[] = ['QueryNew', 'BookingNew'];
const MAIN_PARENT_ROUTES: Record<string, string> = { QueryNew: 'Requests', BookingNew: 'Explore' };

/** Wide: the brand bar is the tab bar, on top. Narrow: a slim brand bar as the header, tabs at the bottom. */
function tabScreenOptions(isWide: boolean) {
  return {
    tabBarPosition: isWide ? ('top' as const) : ('bottom' as const),
    headerShown: !isWide,
    header: () => <AppBar />,
  };
}

/** Tab options with an icon: filled when focused, outline otherwise. */
function tab(title: string, icon: IconName, focusedIcon: IconName) {
  return {
    title,
    tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
      <Icon name={focused ? focusedIcon : icon} color={color} size={size} />
    ),
  };
}

/** The few stack headers left (e.g. the platform's sign-in redirect), in the brand colours. */
const STACK_SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: colors.primary },
  headerTintColor: colors.primaryText,
};

function MainTabsNavigator() {
  const isWide = useIsWide();
  const { user } = useAuth();
  // Signed in on a wide screen, Account sits in the bar's account menu instead.
  const hiddenRoutes = [...MAIN_FORM_PAGES, ...(!user ? GATED_TABS : isWide ? ['Account'] : [])];
  return (
    <MainTabs.Navigator
      tabBar={(props) => (
        <ResponsiveTabBar {...props} hiddenRoutes={hiddenRoutes} parentRoutes={MAIN_PARENT_ROUTES} />
      )}
      screenOptions={tabScreenOptions(isWide)}
    >
      <MainTabs.Screen
        name="Explore"
        component={ExploreScreen}
        options={tab('Explore', 'compass-outline', 'compass')}
      />
      <MainTabs.Screen
        name="Requests"
        component={GatedRequests}
        options={tab('Requests', 'chatbubbles-outline', 'chatbubbles')}
      />
      <MainTabs.Screen
        name="Bookings"
        component={GatedBookings}
        options={tab('Bookings', 'ticket-outline', 'ticket')}
      />
      <MainTabs.Screen
        name="Account"
        component={GatedAccount}
        options={tab('Account', 'person-circle-outline', 'person-circle')}
      />
      <MainTabs.Screen name="QueryNew" component={GatedQueryNew} options={{ title: 'Request options' }} />
      <MainTabs.Screen name="BookingNew" component={GatedBookingNew} options={{ title: 'Book' }} />
    </MainTabs.Navigator>
  );
}

// Pages under a tab (forms, Billing and Plans): not in the bar, which keeps their tab highlighted on them.
const ADMIN_SETTINGS_PAGES: (keyof AdminTabParamList)[] = ['AdminOfferNew', 'AdminQueryRespond', 'AdminBilling', 'AdminPlans'];
const ADMIN_PARENT_ROUTES: Record<string, string> = {
  AdminOfferNew: 'AdminOffers',
  AdminQueryRespond: 'AdminRequests',
  AdminBilling: 'AdminSettings',
  AdminPlans: 'AdminSettings',
};

function AdminTabsNavigator() {
  const isWide = useIsWide();
  return (
    <AdminTabs.Navigator
      tabBar={(props) => (
        <ResponsiveTabBar {...props} hiddenRoutes={ADMIN_SETTINGS_PAGES} parentRoutes={ADMIN_PARENT_ROUTES} />
      )}
      screenOptions={tabScreenOptions(isWide)}
    >
      <AdminTabs.Screen
        name="AdminDashboard"
        component={AdminDashboardScreen}
        options={tab('Dashboard', 'grid-outline', 'grid')}
      />
      <AdminTabs.Screen
        name="AdminOffers"
        component={AdminOffersScreen}
        options={tab('Offers', 'pricetags-outline', 'pricetags')}
      />
      <AdminTabs.Screen
        name="AdminRequests"
        component={AdminRequestsScreen}
        options={tab('Requests', 'chatbubbles-outline', 'chatbubbles')}
      />
      <AdminTabs.Screen
        name="AdminBookings"
        component={AdminBookingsScreen}
        options={tab('Bookings', 'ticket-outline', 'ticket')}
      />
      <AdminTabs.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={tab('Users', 'people-outline', 'people')}
      />
      <AdminTabs.Screen
        name="AdminSettings"
        component={AdminSettingsScreen}
        options={tab('Settings', 'settings-outline', 'settings')}
      />
      <AdminTabs.Screen name="AdminOfferNew" component={FreshOfferNew} options={{ title: 'New offer' }} />
      <AdminTabs.Screen
        name="AdminQueryRespond"
        component={FreshQueryRespond}
        options={{ title: 'Respond to request' }}
      />
      <AdminTabs.Screen name="AdminBilling" component={AdminBillingScreen} options={{ title: 'Billing' }} />
      <AdminTabs.Screen name="AdminPlans" component={AdminPlansScreen} options={{ title: 'Plans' }} />
    </AdminTabs.Navigator>
  );
}

/** A platform page opened while signed out: remember it, sign in first, and PlatformTabsNavigator reopens it. */
function PlatformSignInFirst() {
  const navigation = useNavigation();
  // Read on the first render, before the redirect changes the address.
  const path = useRef(Platform.OS === 'web' ? `${window.location.pathname}${window.location.search}` : null);
  useFocusEffect(
    useCallback(() => {
      if (path.current) {
        setPendingPath(path.current);
      }
      navigation.dispatch(StackActions.replace('PlatformLogin'));
    }, [navigation]),
  );
  return null;
}

function PlatformTabsNavigator() {
  const isWide = useIsWide();
  const linkTo = useLinkTo();
  useEffect(() => {
    const path = takePendingPath();
    if (path) {
      linkTo(path);
    }
  }, [linkTo]);
  return (
    <PlatformTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} />}
      screenOptions={tabScreenOptions(isWide)}
    >
      <PlatformTabs.Screen
        name="PlatformDashboard"
        component={PlatformDashboardScreen}
        options={tab('Dashboard', 'grid-outline', 'grid')}
      />
      <PlatformTabs.Screen
        name="PlatformAgencies"
        component={AgenciesScreen}
        options={tab('Agencies', 'business-outline', 'business')}
      />
      <PlatformTabs.Screen name="PlatformPlans" component={PlansScreen} options={tab('Plans', 'layers-outline', 'layers')} />
      <PlatformTabs.Screen
        name="PlatformInvoices"
        component={InvoicesScreen}
        options={tab('Invoices', 'document-text-outline', 'document-text')}
      />
      <PlatformTabs.Screen
        name="PlatformSettings"
        component={PlatformSettingsScreen}
        options={tab('Settings', 'settings-outline', 'settings')}
      />
    </PlatformTabs.Navigator>
  );
}

/**
 * The root host: a public home page, the system owner's sign-in, and once signed in the owner's screens (the
 * dashboard first). Agency screens are not reachable here.
 */
function PlatformStack() {
  const { user } = useAuth();
  const publicPage = { header: () => <PlatformPublicBar /> };
  return (
    <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
      {user ? (
        <>
          <Stack.Screen name="PlatformTabs" component={PlatformTabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen name="PlatformHome" component={PlatformHomeScreen} options={{ title: 'Home', ...publicPage }} />
          <Stack.Screen
            name="PlatformPricing"
            component={PlatformPricingScreen}
            options={{ title: 'Pricing', ...publicPage }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="PlatformHome" component={PlatformHomeScreen} options={{ title: 'Home', ...publicPage }} />
          <Stack.Screen
            name="PlatformPricing"
            component={PlatformPricingScreen}
            options={{ title: 'Pricing', ...publicPage }}
          />
          <Stack.Screen name="PlatformLogin" component={PlatformLoginScreen} options={{ title: 'Sign in', ...publicPage }} />
          {/* The owner's pages opened while signed out go to sign-in first. */}
          <Stack.Screen name="PlatformTabs" component={PlatformSignInFirst} options={{ title: 'Sign in', ...publicPage }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { user } = useAuth();
  useLoginAfterSignOut(user !== null);

  if (IS_PLATFORM) {
    return <PlatformStack />;
  }

  if (user?.role === 'admin') {
    return <AdminStack />;
  }

  return (
    <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="Main" component={MainTabsNavigator} options={{ headerShown: false }} />
      {/* Guests only: for a signed-in customer these URLs match no screen and open Explore. */}
      {user ? null : (
        <Stack.Group screenOptions={{ header: () => <AppBar brandOnly /> }}>
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Forgot password' }} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset password' }} />
          {/* Admin links opened while signed out go to Login first. */}
          <Stack.Screen name="AdminTabs" component={AdminSignInFirst} options={{ title: 'Sign in' }} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
