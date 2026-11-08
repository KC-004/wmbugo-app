# UI state rule (Zustand)

Zustand holds **transient UI state only**: which sheet is open, the Add sheet's
draft text, the selected tab filter. It must never hold:

- money, totals, balances or anything computed from the ledger (use TanStack Query),
- persistent preferences or settings (they live in the `settings` table and come
  back through a query),
- anything that must survive the app being killed.

Why: a second copy of a number in a store goes stale the moment a save commits,
and the only refresh path is outbox events invalidating query keys.

Enforcement: `zustandPolicy.test.ts` fails when a file that imports `zustand`
declares state with a money, total, balance, currency or setting-like name.
Review rule: if you are unsure whether something belongs in a store, it does not.
