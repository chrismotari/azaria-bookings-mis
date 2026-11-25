import { BottomTabScreenProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StackActions, useFocusEffect, useIsFocused, useLinkTo, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Fragment, ReactNode, useCallback, useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { GetAppScreen } from '../agency/GetAppScreen';
import { useHasModule } from '../agency/modules';
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
import { AdminFaresScreen } from '../screens/admin/AdminFaresScreen';
import { AdminRequestsScreen } from '../screens/admin/AdminRequestsScreen';
import { AdminRoutesScreen } from '../screens/admin/AdminRoutesScreen';
import { useIntegrations } from '../screens/admin/gds';
import { AdminSettingsScreen } from '../screens/admin/AdminSettingsScreen';
import { AdminUsersScreen } from '../screens/admin/AdminUsersScreen';
import { AdminHotelBookScreen } from '../screens/admin/AdminHotelBookScreen';
import { AdminHotelEditScreen, AdminHotelNewScreen } from '../screens/admin/AdminHotelFormScreen';
import { AdminHotelsScreen } from '../screens/admin/AdminHotelsScreen';
import { AdminReviewsScreen } from '../screens/admin/AdminReviewsScreen';
import { AdminTourBookScreen } from '../screens/admin/AdminTourBookScreen';
import { AdminTourEditScreen, AdminTourNewScreen } from '../screens/admin/AdminTourFormScreen';
import { AdminToursScreen } from '../screens/admin/AdminToursScreen';
import { HotelBookScreen } from '../screens/hotels/HotelBookScreen';
import { ExploreListsProvider } from '../screens/explore/exploreLists';
import { HotelDetailScreen } from '../screens/hotels/HotelDetailScreen';
import { TourBookScreen } from '../screens/tours/TourBookScreen';
import { TourDetailScreen } from '../screens/tours/TourDetailScreen';
import { BookingNewScreen } from '../screens/bookings/BookingNewScreen';
import { BookingsScreen } from '../screens/bookings/BookingsScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { AccountScreen } from '../screens/customer/AccountScreen';
import { AdminBillingScreen, OverdueBanner } from '../screens/admin/AdminBillingScreen';
import { AdminPlansScreen } from '../screens/admin/AdminPlansScreen';
import { DeskChatsScreen, PlatformChatsScreen } from '../screens/support/DeskChatsScreen';
import { AdminSupportScreen, SupportScreen } from '../screens/support/SupportScreen';
import { AGENCY_DESK, AGENCY_REQUESTER, PLATFORM_DESK, PLATFORM_VISITOR, useDeskUnread } from '../support/api';
import { ChatLauncher } from '../support/ChatLauncher';
import { AgenciesScreen } from '../screens/platform/AgenciesScreen';
import { InvoicesScreen } from '../screens/platform/InvoicesScreen';
import { PlansScreen } from '../screens/platform/PlansScreen';
import { PlatformSettingsScreen } from '../screens/platform/PlatformSettingsScreen';
import { PlatformDashboardScreen } from '../screens/platform/PlatformDashboardScreen';
import { PlatformHomeScreen } from '../screens/platform/PlatformHomeScreen';
import { PlatformLoginScreen } from '../screens/platform/PlatformLoginScreen';
import { PlatformPricingScreen } from '../screens/platform/PlatformPricingScreen';
import { IS_NATIVE, IS_PLATFORM } from '../config';
import { ExploreScreen } from '../screens/explore/ExploreScreen';
import { QueryNewScreen } from '../screens/requests/QueryNewScreen';
import { RequestsScreen } from '../screens/requests/RequestsScreen';
import { colors, createStyles, useIsWide } from '../theme';
import { AppBar } from './AppBar';
import { PlatformPublicBar } from './PlatformPublicBar';
import { ResponsiveTabBar } from './ResponsiveTabBar';
import { AdminTabParamList, MainTabParamList, PlatformTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();
const AdminTabs = createBottomTabNavigator<AdminTabParamList>();
const PlatformTabs = createBottomTabNavigator<PlatformTabParamList>();

/** An admin URL opened while signed out (e.g. from an email): sign in first; AdminStack reopens it. */
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
      <OverdueBanner />
      <Stack.Navigator screenOptions={stackScreenOptions()}>
        <Stack.Screen name="AdminTabs" component={AdminTabsNavigator} options={{ headerShown: false }} />
        {GET_APP_SCREEN}
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

function GatedTourBook(props: BottomTabScreenProps<MainTabParamList, 'TourBook'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'TourBook', params: props.route.params } }}>
      <FreshEachVisit params={props.route.params}>
        <TourBookScreen {...props} />
      </FreshEachVisit>
    </RequireAuth>
  );
}

function GatedHotelBook(props: BottomTabScreenProps<MainTabParamList, 'HotelBook'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'HotelBook', params: props.route.params } }}>
      <FreshEachVisit params={props.route.params}>
        <HotelBookScreen {...props} />
      </FreshEachVisit>
    </RequireAuth>
  );
}

function FreshTourNew(props: BottomTabScreenProps<AdminTabParamList, 'AdminTourNew'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminTourNewScreen {...props} />
    </FreshEachVisit>
  );
}

function FreshTourEdit(props: BottomTabScreenProps<AdminTabParamList, 'AdminTourEdit'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminTourEditScreen {...props} />
    </FreshEachVisit>
  );
}

function FreshAdminTourBook(props: BottomTabScreenProps<AdminTabParamList, 'AdminTourBook'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminTourBookScreen {...props} />
    </FreshEachVisit>
  );
}

function FreshHotelNew(props: BottomTabScreenProps<AdminTabParamList, 'AdminHotelNew'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminHotelNewScreen {...props} />
    </FreshEachVisit>
  );
}

function FreshHotelEdit(props: BottomTabScreenProps<AdminTabParamList, 'AdminHotelEdit'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminHotelEditScreen {...props} />
    </FreshEachVisit>
  );
}

function FreshAdminHotelBook(props: BottomTabScreenProps<AdminTabParamList, 'AdminHotelBook'>) {
  return (
    <FreshEachVisit params={props.route.params}>
      <AdminHotelBookScreen {...props} />
    </FreshEachVisit>
  );
}

// Login-required tabs, left out of the bar for guests.
const GATED_TABS: (keyof MainTabParamList)[] = ['Requests', 'Bookings', 'Account'];

// Never in the bar; the tab they belong to stays highlighted on them.
const MAIN_FORM_PAGES: (keyof MainTabParamList)[] = [
  'QueryNew',
  'BookingNew',
  'Support',
  'TourDetail',
  'TourBook',
  'HotelDetail',
  'HotelBook',
];
const MAIN_PARENT_ROUTES: Record<string, string> = {
  QueryNew: 'Requests',
  BookingNew: 'Explore',
  Support: 'Account',
  TourDetail: 'Explore',
  TourBook: 'Explore',
  HotelDetail: 'Explore',
  HotelBook: 'Explore',
};

function GatedSupport(props: BottomTabScreenProps<MainTabParamList, 'Support'>) {
  return (
    <RequireAuth target={{ screen: 'Main', params: { screen: 'Support', params: props.route.params } }}>
      <SupportScreen {...props} />
    </RequireAuth>
  );
}

/** Wide: the brand bar is the tab bar, on top. Narrow: a slim brand bar as the header, tabs at the bottom. */
function tabScreenOptions(isWide: boolean) {
  return {
    tabBarPosition: isWide ? ('top' as const) : ('bottom' as const),
    headerShown: !isWide,
    header: () => <AppBar />,
  };
}

function tab(title: string, icon: IconName, focusedIcon: IconName) {
  return {
    title,
    tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
      <Icon name={focused ? focusedIcon : icon} color={color} size={size} />
    ),
  };
}

// Web only: native links to /app open the app's home instead (agency/links.ts).
const GET_APP_SCREEN = IS_NATIVE ? null : (
  <Stack.Screen name="GetApp" component={GetAppScreen} options={{ title: 'Get the app', header: () => <AppBar /> }} />
);

/** Read while rendering: the header follows the agency's theme. */
function stackScreenOptions() {
  return {
    headerStyle: { backgroundColor: colors.primary },
    headerTintColor: colors.primaryText,
  };
}

function MainTabsNavigator() {
  const isWide = useIsWide();
  const { user } = useAuth();
  const flights = useHasModule('flights');
  // Signed in on a wide screen, Account sits in the bar's account menu instead.
  const hiddenRoutes = [
    ...MAIN_FORM_PAGES,
    ...(!user ? GATED_TABS : isWide ? ['Account'] : []),
    ...(flights ? [] : ['Requests']),
  ];
  return (
    <ExploreListsProvider>
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
        <MainTabs.Screen name="Support" component={GatedSupport} options={{ title: 'Support' }} />
        <MainTabs.Screen name="TourDetail" component={TourDetailScreen} options={{ title: 'Tour' }} />
        <MainTabs.Screen name="TourBook" component={GatedTourBook} options={{ title: 'Book tour' }} />
        <MainTabs.Screen name="HotelDetail" component={HotelDetailScreen} options={{ title: 'Hotel' }} />
        <MainTabs.Screen name="HotelBook" component={GatedHotelBook} options={{ title: 'Request booking' }} />
      </MainTabs.Navigator>
    </ExploreListsProvider>
  );
}

// Never in the bar; the tab they belong to stays highlighted on them.
const ADMIN_SETTINGS_PAGES: (keyof AdminTabParamList)[] = [
  'AdminOfferNew',
  'AdminQueryRespond',
  'AdminFares',
  'AdminBilling',
  'AdminPlans',
  'AdminSupport',
  'AdminTourNew',
  'AdminTourEdit',
  'AdminTourBook',
  'AdminHotelNew',
  'AdminHotelEdit',
  'AdminHotelBook',
];
const ADMIN_PARENT_ROUTES: Record<string, string> = {
  AdminOfferNew: 'AdminOffers',
  AdminQueryRespond: 'AdminRequests',
  AdminFares: 'AdminRoutes',
  AdminBilling: 'AdminSettings',
  AdminPlans: 'AdminSettings',
  AdminSupport: 'AdminSettings',
  AdminTourNew: 'AdminTours',
  AdminTourEdit: 'AdminTours',
  AdminTourBook: 'AdminTours',
  AdminHotelNew: 'AdminHotels',
  AdminHotelEdit: 'AdminHotels',
  AdminHotelBook: 'AdminHotels',
};

const ADMIN_FLIGHT_TABS = ['AdminOffers', 'AdminRoutes', 'AdminRequests', 'AdminBookings'];
const ADMIN_NARROW_TABS = ['AdminDashboard', 'AdminOffers', 'AdminRequests', 'AdminBookings'];
const PLATFORM_NARROW_TABS = ['PlatformDashboard', 'PlatformAgencies', 'PlatformInvoices', 'PlatformChats'];

function AdminTabsNavigator() {
  const isWide = useIsWide();
  const unreadChats = useDeskUnread(AGENCY_DESK);
  const flights = useHasModule('flights');
  const tours = useHasModule('tours');
  const hotels = useHasModule('hotels');
  // Routes only matter once the agency has connected a fare provider.
  const integrations = useIntegrations(flights);
  const hiddenRoutes = [
    ...ADMIN_SETTINGS_PAGES,
    ...(flights ? (integrations.data?.length ? [] : ['AdminRoutes']) : ADMIN_FLIGHT_TABS),
    ...(tours ? [] : ['AdminTours']),
    ...(hotels ? [] : ['AdminHotels']),
  ];
  return (
    <AdminTabs.Navigator
      tabBar={(props) => (
        <ResponsiveTabBar
          {...props}
          hiddenRoutes={hiddenRoutes}
          parentRoutes={ADMIN_PARENT_ROUTES}
          narrowTabs={ADMIN_NARROW_TABS}
        />
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
        name="AdminRoutes"
        component={AdminRoutesScreen}
        options={tab('Routes', 'git-branch-outline', 'git-branch')}
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
      <AdminTabs.Screen name="AdminTours" component={AdminToursScreen} options={tab('Tours', 'map-outline', 'map')} />
      <AdminTabs.Screen
        name="AdminHotels"
        component={AdminHotelsScreen}
        options={tab('Hotels', 'bed-outline', 'bed')}
      />
      <AdminTabs.Screen
        name="AdminReviews"
        component={AdminReviewsScreen}
        options={tab('Reviews', 'star-outline', 'star')}
      />
      <AdminTabs.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={tab('Users', 'people-outline', 'people')}
      />
      <AdminTabs.Screen
        name="AdminChats"
        component={DeskChatsScreen}
        options={{
          ...tab('Chats', 'chatbubbles-outline', 'chatbubbles'),
          tabBarBadge: unreadChats.data ? (unreadChats.data > 9 ? '9+' : unreadChats.data) : undefined,
        }}
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
      <AdminTabs.Screen name="AdminFares" component={AdminFaresScreen} options={{ title: 'Fares' }} />
      <AdminTabs.Screen name="AdminBilling" component={AdminBillingScreen} options={{ title: 'Billing' }} />
      <AdminTabs.Screen name="AdminPlans" component={AdminPlansScreen} options={{ title: 'Plans' }} />
      <AdminTabs.Screen name="AdminSupport" component={AdminSupportScreen} options={{ title: 'Support' }} />
      <AdminTabs.Screen name="AdminTourNew" component={FreshTourNew} options={{ title: 'New tour' }} />
      <AdminTabs.Screen name="AdminTourEdit" component={FreshTourEdit} options={{ title: 'Edit tour' }} />
      <AdminTabs.Screen name="AdminTourBook" component={FreshAdminTourBook} options={{ title: 'Book tour' }} />
      <AdminTabs.Screen name="AdminHotelNew" component={FreshHotelNew} options={{ title: 'New hotel' }} />
      <AdminTabs.Screen name="AdminHotelEdit" component={FreshHotelEdit} options={{ title: 'Edit hotel' }} />
      <AdminTabs.Screen name="AdminHotelBook" component={FreshAdminHotelBook} options={{ title: 'Book hotel' }} />
    </AdminTabs.Navigator>
  );
}

/** A platform page opened while signed out: sign in first; PlatformTabsNavigator reopens it. */
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
  const unreadChats = useDeskUnread(PLATFORM_DESK);
  return (
    <PlatformTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} narrowTabs={PLATFORM_NARROW_TABS} />}
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
      <PlatformTabs.Screen
        name="PlatformPlans"
        component={PlansScreen}
        options={tab('Plans', 'layers-outline', 'layers')}
      />
      <PlatformTabs.Screen
        name="PlatformInvoices"
        component={InvoicesScreen}
        options={tab('Invoices', 'document-text-outline', 'document-text')}
      />
      <PlatformTabs.Screen
        name="PlatformChats"
        component={PlatformChatsScreen}
        options={{
          ...tab('Chats', 'chatbubbles-outline', 'chatbubbles'),
          tabBarBadge: unreadChats.data ? (unreadChats.data > 9 ? '9+' : unreadChats.data) : undefined,
        }}
      />
      <PlatformTabs.Screen
        name="PlatformSettings"
        component={PlatformSettingsScreen}
        options={tab('Settings', 'settings-outline', 'settings')}
      />
    </PlatformTabs.Navigator>
  );
}

/** The root host: public pages, the owner's sign-in and, once signed in, the owner's screens. */
function PlatformStack() {
  const { user } = useAuth();
  const publicPage = {
    header: ({ route }: { route: { name: string } }) => <PlatformPublicBar route={route.name} />,
  };
  return (
    <View style={styles.fill}>
      <Stack.Navigator screenOptions={stackScreenOptions()}>
        {user ? (
          <>
            <Stack.Screen name="PlatformTabs" component={PlatformTabsNavigator} options={{ headerShown: false }} />
            <Stack.Screen
              name="PlatformHome"
              component={PlatformHomeScreen}
              options={{ title: 'Home', ...publicPage }}
            />
            <Stack.Screen
              name="PlatformPricing"
              component={PlatformPricingScreen}
              options={{ title: 'Pricing', ...publicPage }}
            />
          </>
        ) : (
          <>
            <Stack.Screen
              name="PlatformHome"
              component={PlatformHomeScreen}
              options={{ title: 'Home', ...publicPage }}
            />
            <Stack.Screen
              name="PlatformPricing"
              component={PlatformPricingScreen}
              options={{ title: 'Pricing', ...publicPage }}
            />
            <Stack.Screen
              name="PlatformLogin"
              component={PlatformLoginScreen}
              options={{ title: 'Sign in', ...publicPage }}
            />
            <Stack.Screen
              name="PlatformTabs"
              component={PlatformSignInFirst}
              options={{ title: 'Sign in', ...publicPage }}
            />
          </>
        )}
      </Stack.Navigator>
      {user ? null : <ChatLauncher endpoints={PLATFORM_VISITOR} />}
    </View>
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
    <View style={styles.fill}>
      <Stack.Navigator screenOptions={stackScreenOptions()}>
        <Stack.Screen name="Main" component={MainTabsNavigator} options={{ headerShown: false }} />
        {GET_APP_SCREEN}
        {/* Signed-in customers: these URLs match no screen and open Explore. */}
        {user ? null : (
          <Stack.Group screenOptions={{ header: () => <AppBar brandOnly /> }}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ title: 'Forgot password' }}
            />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset password' }} />
            <Stack.Screen name="AdminTabs" component={AdminSignInFirst} options={{ title: 'Sign in' }} />
          </Stack.Group>
        )}
      </Stack.Navigator>
      <ChatLauncher endpoints={AGENCY_REQUESTER} />
    </View>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1 },
}));
