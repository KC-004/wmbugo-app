import { unavailableNotifier, type Notifier } from '@wmbugo/core';

/**
 * The notification adapter the app uses. The react-native-notify-kit adapter replaces `unavailableNotifier` here when the
 * library is added; until then no screen asks for a notification permission it could not use, and no alert is posted. The
 * alert logic itself (what crosses, what is recorded, what is muted) runs regardless.
 */
export const appNotifier: Notifier = unavailableNotifier;
