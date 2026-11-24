import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import type { ReceiptDraft } from '@wmbugo/core';
import type { PendingPhoto } from '../../adapters/files/receiptFiles';
import { ScanLoader } from '../../shared/brand/ScanLoader';
import { copy } from '../../shared/copy';
import { useReducedMotion } from '../../shared/a11y/useReducedMotion';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { ScreenFrame } from '../../shared/ui/ScreenFrame';
import { TopBar } from '../../shared/ui/TopBar';
import { intakePhoto, readPhoto, realScanApi, type ScanApi } from './receiptScanApi';

type Phase =
  | { kind: 'working'; photo: PendingPhoto | null; reading: boolean }
  | { kind: 'error'; message: string; photo: PendingPhoto | null; retry: boolean }
  | { kind: 'duplicate'; transactionId: string };

/** The pause between one item name appearing and the next (none when motion is reduced is handled by showing them at once). */
const REVEAL_MS = 120;

/**
 * Pick a receipt photo and watch it being read (SCR-31, Story 10.6). Nothing is written but the one processed, encrypted photo copy;
 * Cancel or Back aborts the read and deletes that copy. A good read hands the draft and the pending photo to the review.
 */
export function ReceiptScanScreen({
  uri,
  provenance = 'photo_picker',
  api = realScanApi,
  onCancel,
  onRead,
  onByHand,
  onOpenEntry,
  onTaken,
  allowByHand = true,
}: {
  /** An image already chosen (Story 10.7 camera, or 10.9 for a shared image). Without it the Photo Picker opens. */
  uri?: string;
  provenance?: PendingPhoto['provenance'];
  api?: ScanApi;
  onCancel: () => void;
  onRead: (draft: ReceiptDraft, photo: PendingPhoto) => void;
  /** The photo stays: it becomes the attachment of the entry she types, and is deleted if she dismisses that sheet. */
  onByHand: (photo: PendingPhoto) => void;
  onOpenEntry: (transactionId: string) => void;
  /** Called once the image has been taken in (or failed to be), so a camera's temporary file can be deleted. */
  onTaken?: () => void;
  /** False in attach mode: typing a new entry would record the same payment twice, so the way out is back to the entry. */
  allowByHand?: boolean;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>({ kind: 'working', photo: null, reading: false });
  const [shown, setShown] = useState(0);
  const [total, setTotal] = useState(0);
  const [plain, setPlain] = useState<string | null>(null);
  const [names, setNames] = useState<readonly string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const photoRef = useRef<PendingPhoto | null>(null);
  const live = useRef(true);
  const handedOver = useRef(false);

  const dropPhoto = useCallback(() => {
    const p = photoRef.current;
    photoRef.current = null;
    if (p && !handedOver.current) void api.files.remove(p.attachmentId).catch(() => undefined);
  }, [api]);

  const read = useCallback(
    async (photo: PendingPhoto) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setPhase({ kind: 'working', photo, reading: true });
      setShown(0);
      setTotal(0);
      setNames([]);
      const out = await readPhoto(api, photo, ctl.signal, setPlain);
      if (!live.current || ctl.signal.aborted || out.kind === 'cancelled') return;
      if (out.kind === 'failed') {
        setPhase({ kind: 'error', photo, retry: out.reason !== 'unavailable', message: out.reason === 'unavailable' ? copy.receiptScan.unavailable : copy.receiptScan.unreadable });
        return;
      }
      const items = out.draft.items.map((i) => i.name).filter((n) => n.length > 0);
      setNames(items);
      setTotal(items.length);
      // Item names appear one by one under the photo, then the review opens.
      // At most about a second and a half in all, and none when motion is reduced.
      const pause = reduced ? 0 : Math.min(REVEAL_MS, Math.floor(1500 / Math.max(1, items.length)));
      for (let i = 1; i <= items.length; i++) {
        if (pause > 0) await new Promise((r) => setTimeout(r, pause));
        if (!live.current || ctl.signal.aborted) return;
        setShown(i);
      }
      handedOver.current = true;
      onRead(out.draft, photo);
    },
    [api, onRead, reduced],
  );

  useEffect(() => {
    live.current = true;
    let cancelled = false;
    void (async () => {
      let source = uri ?? null;
      if (source === null) {
        try {
          source = await api.files.pick();
        } catch {
          source = null;
        }
        if (cancelled) return;
        if (source === null) {
          onCancel();
          return;
        }
      }
      const taken = await intakePhoto(api, source, provenance);
      onTaken?.();
      if (cancelled) {
        if (taken.kind === 'ready') await api.files.remove(taken.photo.attachmentId).catch(() => undefined);
        return;
      }
      if (taken.kind === 'duplicate') return setPhase({ kind: 'duplicate', transactionId: taken.transactionId });
      if (taken.kind === 'failed') return setPhase({ kind: 'error', photo: null, retry: false, message: copy.receiptScan.intakeFailed });
      photoRef.current = taken.photo;
      await read(taken.photo);
    })();
    return () => {
      cancelled = true;
      live.current = false;
      abort.current?.abort();
      dropPhoto();
      void api.files.clearViewCache().catch(() => undefined);
    };
  }, []);

  const cancel = useCallback(() => {
    abort.current?.abort();
    dropPhoto();
    onCancel();
  }, [dropPhoto, onCancel]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => sub.remove();
  }, [cancel]);

  const byHand = (photo: PendingPhoto | null) => {
    if (photo) {
      handedOver.current = true;
      onByHand(photo);
    } else onCancel();
  };

  return (
    <ScreenFrame testID="receipt-scan">
      <TopBar title={copy.receiptReview.title} onBack={cancel} />
      {phase.kind === 'working' ? (
        <ScanLoader
          photoUri={plain}
          title={copy.receiptScan.reading}
          reassurance={copy.receiptScan.nothingSaved}
          photoLabel={copy.receiptScan.photo}
          progress={total > 0 ? shown / total : 0}
          {...(total > 0 ? { progressText: copy.receiptScan.progress.replace('{done}', String(shown)).replace('{total}', String(total)) } : {})}
        >
          {names.slice(0, shown).map((n, i) => (
            <Text key={`${i}-${n}`} testID={`scan-item-${i}`} style={[textStyle('body'), { color: theme.color('text-primary') }]}>{n}</Text>
          ))}
          <Button label={copy.receiptScan.cancel} variant="text" testID="scan-cancel" onPress={cancel} />
        </ScanLoader>
      ) : null}
      {phase.kind === 'error' ? (
        <View style={styles.content}>
          <Text testID="scan-error" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{phase.message}</Text>
          {phase.retry && phase.photo ? <Button label={copy.receiptScan.tryAgain} testID="scan-retry" onPress={() => void read(phase.photo as PendingPhoto)} /> : null}
          {allowByHand ? <Button label={copy.receiptScan.byHand} variant={phase.retry ? 'text' : 'primary'} testID="scan-by-hand" onPress={() => byHand(phase.photo)} /> : <Button label={copy.common.close} variant="text" testID="scan-close-error" onPress={cancel} />}
        </View>
      ) : null}
      {phase.kind === 'duplicate' ? (
        <View style={styles.content}>
          <Text testID="scan-duplicate" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('text-primary') }]}>{copy.receiptScan.alreadySaved}</Text>
          <Button label={copy.receiptScan.openIt} testID="scan-open-it" onPress={() => onOpenEntry(phase.transactionId)} />
          <Button label={copy.common.close} variant="text" testID="scan-close" onPress={onCancel} />
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
});
