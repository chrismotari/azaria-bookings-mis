import { ReactNode, useEffect } from 'react';

import { LoadingState } from '../components/StatusViews';
import { refreshAgency, useAgencyState } from './agency';
import { FindAgencyScreen } from './FindAgencyScreen';
import { startAgencyLinks } from './links';

/**
 * Native: the shared app needs an agency, from a link or a typed code, before anything else. render(session) gets
 * a new session number whenever the agency or the session is replaced, so the app below starts afresh. The app
 * opens in the stored agency's theme and modules and then checks them for changes.
 */
export function AgencyGate({ render }: { render: (session: number) => ReactNode }) {
  const { agency, loaded, session } = useAgencyState();
  useEffect(() => startAgencyLinks(), []);
  const code = agency?.code;
  useEffect(() => {
    if (code) {
      refreshAgency(code);
    }
  }, [code]);
  if (!loaded) {
    return <LoadingState />;
  }
  if (!agency) {
    return <FindAgencyScreen />;
  }
  return render(session);
}
