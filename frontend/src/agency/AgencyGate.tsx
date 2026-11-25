import { ReactNode, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AgencyInfo } from '../api/types';
import { LoadingState } from '../components/StatusViews';
import { IS_PLATFORM } from '../config';
import { applyTheme } from '../theme';
import { setModules } from './modules';

/**
 * Web: the address decides the agency, so there is nothing to find (see AgencyGate.native.tsx); its theme and
 * modules are applied before the first screen, which waits in Azaria's own colours. The platform keeps Azaria's colours.
 */
export function AgencyGate({ render }: { render: (session: number) => ReactNode }) {
  const [ready, setReady] = useState(IS_PLATFORM);
  useEffect(() => {
    if (IS_PLATFORM) {
      return;
    }
    api
      .get<AgencyInfo>('/agency')
      .then(({ data }) => {
        applyTheme(data.theme.colors);
        setModules(data.modules);
      })
      // No agency here, or it is suspended: the app shows the server's message (in Azaria's colours).
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  if (!ready) {
    return <LoadingState />;
  }
  return render(0);
}
