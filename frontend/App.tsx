import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { LoadingState } from './src/components/StatusViews';
import { linking } from './src/navigation/linking';
import { navigationRef } from './src/navigation/navigationRef';
import { RootNavigator } from './src/navigation/RootNavigator';

function shouldRetry(failureCount: number, error: unknown) {
  // Client errors will not fix themselves.
  if (isAxiosError(error) && error.response && error.response.status < 500) {
    return false;
  }
  return failureCount < 2;
}

function Navigation() {
  const { ready } = useAuth();
  if (!ready) {
    return <LoadingState />;
  }
  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      documentTitle={{
        formatter: (options) => (options?.title ? `${options.title} · Azaria Bookings` : 'Azaria Bookings'),
      }}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: shouldRetry }, mutations: { retry: false } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
