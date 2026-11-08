import { QueryClient } from '@tanstack/react-query';
import { areasFor, EVENT_CATALOGUE, type EventHandler, type EventName, type HandlerMap } from '@wmbugo/core';

/**
 * TanStack Query holds every read of saved data. `networkMode: 'always'`
 * because there is no network: without it queries would pause as "offline".
 * Every query key starts with its area (`['ledger', ...]`, `['home', ...]`).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always', retry: false, staleTime: Infinity },
      mutations: { networkMode: 'always' },
    },
  });
}

/** An event invalidates only the query areas the catalogue maps it to. */
export function invalidationHandler(queryClient: QueryClient, name: EventName): EventHandler {
  return async () => {
    await Promise.all(areasFor(name).map((area) => queryClient.invalidateQueries({ queryKey: [area] })));
  };
}

export function invalidationHandlers(queryClient: QueryClient): HandlerMap {
  const map: HandlerMap = {};
  for (const name of Object.keys(EVENT_CATALOGUE) as EventName[]) {
    map[name] = [invalidationHandler(queryClient, name)];
  }
  return map;
}

/** The app-wide client. Outbox delivery invalidates it; screens read through it. */
export const queryClient = createQueryClient();
