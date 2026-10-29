import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { RequireAuth } from '../auth/gate';
import { useSignOut } from '../auth/useSignOut';
import { AdminOfferingEditScreen, AdminOfferingNewScreen } from '../screens/admin/AdminOfferingFormScreen';
import { AdminOfferingsScreen } from '../screens/admin/AdminOfferingsScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { AccountScreen } from '../screens/customer/AccountScreen';
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

function MainTabsNavigator() {
  const isWide = useIsWide();
  return (
    <MainTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} />}
      screenOptions={{ tabBarPosition: isWide ? 'left' : 'bottom' }}
    >
      <MainTabs.Screen name="Account" component={GatedAccount} options={{ title: 'Account' }} />
    </MainTabs.Navigator>
  );
}

function LogoutButton() {
  const signOut = useSignOut();
  return (
    <Pressable accessibilityRole="button" onPress={signOut} style={styles.headerButton}>
      <Text style={styles.headerButtonText}>Log out</Text>
    </Pressable>
  );
}

function AdminTabsNavigator() {
  const isWide = useIsWide();
  return (
    <AdminTabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} />}
      screenOptions={{ tabBarPosition: isWide ? 'left' : 'bottom', headerRight: () => <LogoutButton /> }}
    >
      <AdminTabs.Screen name="AdminOfferings" component={AdminOfferingsScreen} options={{ title: 'Offerings' }} />
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
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator initialRouteName={user ? 'Main' : 'Login'}>
      <Stack.Screen name="Main" component={MainTabsNavigator} options={{ headerShown: false }} />
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
  headerButton: { paddingHorizontal: 16, paddingVertical: 8 },
  headerButtonText: { color: colors.primary, fontWeight: '600' },
});
