import { useQuery } from '@tanstack/react-query';
import { REVIEW_COUNT_SQL } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface ReviewApi {
  /** How many entries wait for the user. */
  count(): Promise<number>;
}

export const realReviewApi: ReviewApi = {
  async count() {
    return Number((await getServices().db.query(REVIEW_COUNT_SQL))[0]?.[0] ?? 0);
  },
};

export const REVIEW_DOT_KEY = ['ledger', 'review-dot'] as const;

/** True while any entry waits for the user: the small dot on the Activity tab (no count). */
export function useReviewDot(api: ReviewApi = realReviewApi): boolean {
  const q = useQuery({ queryKey: REVIEW_DOT_KEY, queryFn: () => api.count() });
  return (q.data ?? 0) > 0;
}
