import { ReactNode } from 'react';

/** Web: the address decides the agency, so there is nothing to find (see AgencyGate.native.tsx). */
export function AgencyGate({ render }: { render: (session: number) => ReactNode }) {
  return render(0);
}
