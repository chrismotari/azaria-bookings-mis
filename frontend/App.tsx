import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AgencyGate } from './src/agency/AgencyGate';
import { useTenantProblem } from './src/api/tenant';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ConfirmProvider } from './src/components/ConfirmDialog';
import { LoadingState } from './src/components/StatusViews';
import { TenantUnavailable } from './src/components/TenantUnavailable';
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
  const tenantProblem = useTenantProblem();
  if (tenantProblem) {
    return <TenantUnavailable message={tenantProblem} />;
  }
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

/** Everything that belongs to one agency and one session: rebuilt from scratch when either changes. */
function Session() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: shouldRetry }, mutations: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfirmProvider>
          <Navigation />
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AgencyGate render={(session) => <Session key={session} />} />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
