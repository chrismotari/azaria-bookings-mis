import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { RequireAuth } from '../auth/gate';
import { useSignOut } from '../auth/useSignOut';
import { AdminBookingDetailScreen } from '../screens/admin/AdminBookingDetailScreen';
import { AdminBookingsScreen } from '../screens/admin/AdminBookingsScreen';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { AdminOfferingEditScreen, AdminOfferingNewScreen } from '../screens/admin/AdminOfferingFormScreen';
import { AdminOfferingsScreen } from '../screens/admin/AdminOfferingsScreen';
import { AdminQueryDetailScreen } from '../screens/admin/AdminQueryDetailScreen';
import { AdminQueryRespondScreen } from '../screens/admin/AdminQueryRespondScreen';
import { AdminRequestsScreen } from '../screens/admin/AdminRequestsScreen';
import { BookingDetailScreen } from '../screens/bookings/BookingDetailScreen';
import { BookingNewScreen } from '../screens/bookings/BookingNewScreen';
import { BookingsScreen } from '../screens/bookings/BookingsScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { AccountScreen } from '../screens/customer/AccountScreen';
import { ExploreScreen } from '../screens/explore/ExploreScreen';
import { OfferingDetailScreen } from '../screens/explore/OfferingDetailScreen';
import { QueryDetailScreen } from '../screens/requests/QueryDetailScreen';
import { QueryNewScreen } from '../screens/requests/QueryNewScreen';
import { RequestsScreen } from '../screens/requests/RequestsScreen';
import { colors, useIsWide } from '../theme';
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

function GatedRequests() {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Requests' } }}>
      <RequestsScreen />
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

function GatedQueryDetail(props: NativeStackScreenProps<RootStackParamList, 'QueryDetail'>) {
  return (
    <RequireAuth target={{ screen: 'QueryDetail', params: props.route.params }}>
      <QueryDetailScreen {...props} />
    </RequireAuth>
  );
}

function GatedBookings() {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Bookings' } }}>
      <BookingsScreen />
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

function GatedBookingDetail(props: NativeStackScreenProps<RootStackParamList, 'BookingDetail'>) {
  return (
    <RequireAuth target={{ screen: 'BookingDetail', params: props.route.params }}>
      <BookingDetailScreen {...props} />
    </RequireAuth>
  );
}

// Login-required tabs, left out of the bar for guests.
const GATED_TABS: (keyof MainTabParamList)[] = ['Requests', 'Bookings', 'Account'];

function GuestHeaderActions() {
  const navigation = useNavigation();
  return (
    <View style={styles.headerActions}>
      <HeaderButton title="Sign in" onPress={() => navigation.navigate('Login')} />
      <HeaderButton title="Create account" onPress={() => navigation.navigate('Register')} />
    </View>
  );
}

function MainTabsNavigator() {
  const isWide = useIsWide();
  const { user } = useAuth();
  return (
    <MainTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} hiddenRoutes={user ? [] : GATED_TABS} />}
      screenOptions={{
        tabBarPosition: isWide ? 'left' : 'bottom',
        headerRight: user ? undefined : () => <GuestHeaderActions />,
      }}
    >
      <MainTabs.Screen name="Explore" component={ExploreScreen} options={{ title: 'Explore' }} />
      <MainTabs.Screen name="Requests" component={GatedRequests} options={{ title: 'Requests' }} />
      <MainTabs.Screen name="Bookings" component={GatedBookings} options={{ title: 'Bookings' }} />
      <MainTabs.Screen name="Account" component={GatedAccount} options={{ title: 'Account' }} />
    </MainTabs.Navigator>
  );
}

function HeaderButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.headerButton}>
      <Text style={styles.headerButtonText}>{title}</Text>
    </Pressable>
  );
}

function LogoutButton() {
  const signOut = useSignOut();
  return <HeaderButton title="Log out" onPress={signOut} />;
}

function AdminTabsNavigator() {
  const isWide = useIsWide();
  return (
    <AdminTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} />}
      screenOptions={{ tabBarPosition: isWide ? 'left' : 'bottom', headerRight: () => <LogoutButton /> }}
    >
      <AdminTabs.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
      <AdminTabs.Screen name="AdminOfferings" component={AdminOfferingsScreen} options={{ title: 'Offerings' }} />
      <AdminTabs.Screen name="AdminRequests" component={AdminRequestsScreen} options={{ title: 'Requests' }} />
      <AdminTabs.Screen name="AdminBookings" component={AdminBookingsScreen} options={{ title: 'Bookings' }} />
    </AdminTabs.Navigator>
  );
}

export function RootNavigator() {
  const { user } = useAuth();

  if (user?.role === 'admin') {
    return (
      <Stack.Navigator>
        <Stack.Screen name="AdminTabs" component={AdminTabsNavigator} options={{ headerShown: false }} />
        <Stack.Screen name="AdminOfferingNew" component={AdminOfferingNewScreen} options={{ title: 'New offering' }} />
        <Stack.Screen
          name="AdminOfferingEdit"
          component={AdminOfferingEditScreen}
          options={{ title: 'Edit offering' }}
        />
        <Stack.Screen name="AdminQueryDetail" component={AdminQueryDetailScreen} options={{ title: 'Request' }} />
        <Stack.Screen
          name="AdminQueryRespond"
          component={AdminQueryRespondScreen}
          options={{ title: 'Respond to request' }}
        />
        <Stack.Screen name="AdminBookingDetail" component={AdminBookingDetailScreen} options={{ title: 'Booking' }} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={MainTabsNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="OfferingDetail" component={OfferingDetailScreen} options={{ title: 'Flight deal' }} />
      <Stack.Screen name="QueryNew" component={GatedQueryNew} options={{ title: 'Request options' }} />
      <Stack.Screen name="QueryDetail" component={GatedQueryDetail} options={{ title: 'Request' }} />
      <Stack.Screen name="BookingNew" component={GatedBookingNew} options={{ title: 'Book' }} />
      <Stack.Screen name="BookingDetail" component={GatedBookingDetail} options={{ title: 'Booking' }} />
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ title: 'Create account', headerShown: false }}
      />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ title: 'Forgot password', headerShown: false }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Reset password', headerShown: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row' },
  headerButton: { paddingHorizontal: 12, paddingVertical: 8 },
  headerButtonText: { color: colors.primary, fontWeight: '600' },
});
