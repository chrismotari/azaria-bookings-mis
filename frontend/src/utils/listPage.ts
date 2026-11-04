import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';

/** A list's page number, back to 1 whenever the filter changes (from its own control or a link). */
export function useListPage(filter: unknown) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [filter]);
  return [page, setPage] as const;
}

/** Back to page 1 when the page no longer exists, e.g. after its last item moved to another status. */
export function useMissingPageReset(error: unknown, page: number, setPage: (page: number) => void) {
  useEffect(() => {
    if (page > 1 && isAxiosError(error) && error.response?.status === 404) {
      setPage(1);
    }
  }, [error, page, setPage]);
}
