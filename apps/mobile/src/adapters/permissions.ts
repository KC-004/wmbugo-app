import type { NotificationPermission } from '@wmbugo/core';
import { appNotifier } from './notifier';

/**
 * Every runtime permission the app can ask for. Each kind has a row in `src/shared/PERMISSIONS.md` (a CI test enforces
 * it): the feature that needs it, the in-context rationale, what still works when it is denied, and how revocation is
 * handled. Nothing is ever requested during onboarding.
 */
export type PermissionKind = 'notifications';

/** The only way the app asks for a runtime permission. Screens call it from a just-in-time sheet the user answered Yes to. */
export async function requestPermission(kind: PermissionKind): Promise<NotificationPermission> {
  switch (kind) {
    case 'notifications':
      return appNotifier.requestPermission();
  }
}

/** The current state, read fresh each time so a change made in Android settings shows without a restart. */
export async function permissionState(kind: PermissionKind): Promise<NotificationPermission> {
  switch (kind) {
    case 'notifications':
      return appNotifier.available ? appNotifier.permission() : 'denied';
  }
}

/** The query areas whose screens show a notification-permission state (Bills, Plan, Budgets). */
export const PERMISSION_VIEW_AREAS = ['bills', 'plan', 'budgets', 'notifications'] as const;

/**
 * Called when the app comes back to the foreground. If notifications were switched off (or on) in Android settings while
 * wmbugo was in the background, the screens that show that state read it again: no restart, no prompt, no crash.
 */
export async function refreshPermissionViews(client: { invalidateQueries(filter: { queryKey: readonly unknown[] }): Promise<void> }): Promise<void> {
  if (!appNotifier.available) return;
  await Promise.all(PERMISSION_VIEW_AREAS.map((area) => client.invalidateQueries({ queryKey: [area] })));
}
