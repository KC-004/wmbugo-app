import type { NotificationPermission } from '@wmbugo/core';
import { appNotifier } from './notifier';

/**
 * Every runtime permission the app can ask for. Each kind has a row in `src/shared/PERMISSIONS.md` (a CI test enforces
 * it): the feature that needs it, the in-context rationale, what still works when it is denied, and how revocation is
 * handled. Nothing is ever requested during onboarding.
 */
export type PermissionKind = 'notifications' | 'camera';

/** The camera permission lives in VisionCamera's factory; it is loaded only when the camera is first used so no other screen pays for it. */
async function cameraFactory(): Promise<{ cameraPermissionStatus: string; requestCameraPermission(): Promise<boolean> }> {
  // Metro's inline require loads the module on first use only; a dynamic import would be split into its own chunk.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('react-native-vision-camera') as { VisionCamera: { cameraPermissionStatus: string; requestCameraPermission(): Promise<boolean> } }).VisionCamera;
}

const cameraState = (status: string): NotificationPermission => (status === 'authorized' ? 'granted' : status === 'not-determined' ? 'undetermined' : 'denied');

/** The only way the app asks for a runtime permission. Screens call it from a just-in-time sheet the user answered Yes to. */
export async function requestPermission(kind: PermissionKind): Promise<NotificationPermission> {
  switch (kind) {
    case 'notifications':
      return appNotifier.requestPermission();
    case 'camera':
      try {
        const camera = await cameraFactory();
        await camera.requestCameraPermission();
        return cameraState(camera.cameraPermissionStatus);
      } catch {
        return 'denied';
      }
  }
}

/** The current state, read fresh each time so a change made in Android settings shows without a restart. */
export async function permissionState(kind: PermissionKind): Promise<NotificationPermission> {
  switch (kind) {
    case 'notifications':
      return appNotifier.available ? appNotifier.permission() : 'denied';
    case 'camera':
      try {
        return cameraState((await cameraFactory()).cameraPermissionStatus);
      } catch {
        return 'denied';
      }
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
