import { useEffect, useRef } from 'react';
import { takeRestoreOutcome } from '../../adapters/startApp';
import { copy } from '../../shared/copy';
import { useToast } from '../../shared/feedback/ToastHost';

/**
 * After a restart that followed a restore (Story 8.8, 8.9), says what happened once: `Restored from your 3 Nov backup`, or, if the
 * restored data failed its start checks and the safety copy was put back, `The restore didn't finish. Your phone is as it was before.`
 */
export function RestoreNoticeHost({ readNotice }: { readNotice?: () => Promise<string | null> }) {
  const toast = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void (async () => {
      try {
        const outcome = takeRestoreOutcome();
        if (outcome === 'restore-failed') {
          toast.show({ message: copy.restore.failed });
          return;
        }
        if (outcome !== 'restored') return;
        const when = await (readNotice ?? (async () => (await import('../../adapters/backup/restoreNotice')).takeRestoreNotice()))();
        toast.show({ message: when ? copy.restore.restored.replace('{when}', when) : copy.restore.restored.replace('Restored from your {when} backup', 'Restored from your backup') });
      } catch {
        /* the notice is a nicety */
      }
    })();
  }, [toast, readNotice]);
  return null;
}
