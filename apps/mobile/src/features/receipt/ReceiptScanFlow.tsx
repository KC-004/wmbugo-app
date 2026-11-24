import { useEffect, useRef, useState } from 'react';
import type { ReceiptDraft } from '@wmbugo/core';
import type { PendingPhoto } from '../../adapters/files/receiptFiles';
import { realReceiptApi, type ReceiptApi } from './receiptApi';
import { ReceiptReviewScreen } from './ReceiptReviewScreen';
import { ReceiptScanScreen } from './ReceiptScanScreen';
import { realScanApi, type ScanApi } from './receiptScanApi';

/**
 * Pick or take a receipt, watch it being read, then review it (Stories 10.6 to 10.9). Every receipt source ends here: a camera photo,
 * a picked photo, a shared image. With `attachTo` the review opens in attach mode for that recorded entry.
 */
export function ReceiptScanFlow({
  uri,
  provenance,
  attachTo,
  scanApi = realScanApi,
  receiptApi = realReceiptApi,
  onTaken,
  onLeave,
  onByHand,
  onOpenEntry,
  onClose,
}: {
  uri?: string;
  provenance?: PendingPhoto['provenance'];
  attachTo?: string;
  scanApi?: ScanApi;
  receiptApi?: ReceiptApi;
  onTaken?: () => void;
  /** Cancel or Back while choosing or reading: nothing was written. */
  onLeave: () => void;
  onByHand: (photo: PendingPhoto) => void;
  onOpenEntry: (transactionId: string) => void;
  /** The review is over (saved, attached or discarded). */
  onClose: () => void;
}) {
  const [read, setRead] = useState<{ draft: ReceiptDraft; photo: PendingPhoto } | null>(null);
  const kept = useRef(false);
  // A photo that was read but never saved or attached is deleted when the flow goes away.
  useEffect(
    () => () => {
      if (read && !kept.current) void scanApi.files.remove(read.photo.attachmentId).catch(() => undefined);
    },
    [read, scanApi],
  );
  if (read)
    return (
      <ReceiptReviewScreen
        draft={read.draft}
        photo={read.photo}
        api={receiptApi}
        {...(attachTo ? { attachTo } : {})}
        onDiscardPhoto={() => void scanApi.files.remove(read.photo.attachmentId).catch(() => undefined)}
        onSaved={() => {
          kept.current = true;
        }}
        onClose={onClose}
      />
    );
  return (
    <ReceiptScanScreen
      api={scanApi}
      {...(uri ? { uri } : {})}
      {...(provenance ? { provenance } : {})}
      {...(onTaken ? { onTaken } : {})}
      onCancel={onLeave}
      onRead={(draft, photo) => setRead({ draft, photo })}
      onByHand={onByHand}
      onOpenEntry={onOpenEntry}
    />
  );
}
