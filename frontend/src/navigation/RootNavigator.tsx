import { BottomTabScreenProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../auth/AuthContext';
import { RequireAuth } from '../auth/gate';
import { AdminBookingsScreen } from '../screens/admin/AdminBookingsScreen';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { AdminOfferNewScreen } from '../screens/admin/AdminOfferFormScreen';
import { AdminOffersScreen } from '../screens/admin/AdminOffersScreen';
import { AdminQueryRespondScreen } from '../screens/admin/AdminQueryRespondScreen';
import { AdminRequestsScreen } from '../screens/admin/AdminRequestsScreen';
import { AdminSettingsScreen } from '../screens/admin/AdminSettingsScreen';
import { BookingNewScreen } from '../screens/bookings/BookingNewScreen';
import { BookingsScreen } from '../screens/bookings/BookingsScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { AccountScreen } from '../screens/customer/AccountScreen';
import { ExploreScreen } from '../screens/explore/ExploreScreen';
import { QueryNewScreen } from '../screens/requests/QueryNewScreen';
import { RequestsScreen } from '../screens/requests/RequestsScreen';
import { colors, useIsWide } from '../theme';
import { AppBar } from './AppBar';
import { ResponsiveTabBar } from './ResponsiveTabBar';
import { AdminTabParamList, MainTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();
const AdminTabs = createBottomTabNavigator<AdminTabParamList>();

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

function GatedQueryNew(props: NativeStackScreenProps<RootStackParamList, 'QueryNew'>) {
  return (
    <RequireAuth target={{ screen: 'QueryNew', params: props.route.params }}>
      <QueryNewScreen {...props} />
    </RequireAuth>
  );
}

function GatedBookings(props: BottomTabScreenProps<MainTabParamList, 'Bookings'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Bookings', params: props.route.params } }}>
      <BookingsScreen {...props} />
    </RequireAuth>
  );
}

function GatedBookingNew(props: NativeStackScreenProps<RootStackParamList, 'BookingNew'>) {
  return (
    <RequireAuth target={{ screen: 'BookingNew', params: props.route.params }}>
      <BookingNewScreen {...props} />
    </RequireAuth>
  );
}

// Login-required tabs, left out of the bar for guests.
const GATED_TABS: (keyof MainTabParamList)[] = ['Requests', 'Bookings', 'Account'];

/** Wide: the brand bar is the tab bar, on top. Narrow: a slim brand bar as the header, tabs at the bottom. */
function tabScreenOptions(isWide: boolean) {
  return {
    tabBarPosition: isWide ? ('top' as const) : ('bottom' as const),
    headerShown: !isWide,
    header: () => <AppBar />,
  };
}

/** Stack pages (the forms) keep a back button, in the brand colours. */
const STACK_SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: colors.primary },
  headerTintColor: colors.primaryText,
};

function MainTabsNavigator() {
  const isWide = useIsWide();
  const { user } = useAuth();
  // Signed in on a wide screen, Account sits in the bar's account menu instead.
  const hiddenRoutes = !user ? GATED_TABS : isWide ? ['Account'] : [];
  return (
    <MainTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} hiddenRoutes={hiddenRoutes} />}
      screenOptions={tabScreenOptions(isWide)}
    >
      <MainTabs.Screen name="Explore" component={ExploreScreen} options={{ title: 'Explore' }} />
      <MainTabs.Screen name="Requests" component={GatedRequests} options={{ title: 'Requests' }} />
      <MainTabs.Screen name="Bookings" component={GatedBookings} options={{ title: 'Bookings' }} />
      <MainTabs.Screen name="Account" component={GatedAccount} options={{ title: 'Account' }} />
    </MainTabs.Navigator>
  );
}

function AdminTabsNavigator() {
  const isWide = useIsWide();
  return (
    <AdminTabs.Navigator tabBar={(props) => <ResponsiveTabBar {...props} />} screenOptions={tabScreenOptions(isWide)}>
      <AdminTabs.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
      <AdminTabs.Screen name="AdminOffers" component={AdminOffersScreen} options={{ title: 'Offers' }} />
      <AdminTabs.Screen name="AdminRequests" component={AdminRequestsScreen} options={{ title: 'Requests' }} />
      <AdminTabs.Screen name="AdminBookings" component={AdminBookingsScreen} options={{ title: 'Bookings' }} />
      <AdminTabs.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: 'Settings' }} />
    </AdminTabs.Navigator>
  );
}

export function RootNavigator() {
  const { user } = useAuth();

  if (user?.role === 'admin') {
    return (
      <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
        <Stack.Screen name="AdminTabs" component={AdminTabsNavigator} options={{ headerShown: false }} />
        <Stack.Screen name="AdminOfferNew" component={AdminOfferNewScreen} options={{ title: 'New offer' }} />
        <Stack.Screen
          name="AdminQueryRespond"
          component={AdminQueryRespondScreen}
          options={{ title: 'Respond to request' }}
        />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="Main" component={MainTabsNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="QueryNew" component={GatedQueryNew} options={{ title: 'Request options' }} />
      <Stack.Screen name="BookingNew" component={GatedBookingNew} options={{ title: 'Book' }} />
      {/* Guests only: for a signed-in customer these URLs match no screen and open Explore. */}
      {user ? null : (
        <Stack.Group screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Forgot password' }} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset password' }} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
