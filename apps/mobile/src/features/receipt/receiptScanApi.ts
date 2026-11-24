import { isOcrFailure, parseReceipt, type OcrEngine, type ReceiptDraft } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { realScanFiles, type PendingPhoto, type ReceiptScanFiles } from '../../adapters/files/receiptFiles';
import { realOcrEngine } from '../../adapters/ocr/ocrEngine';

/** Reading gives up after this long (Story 10.6). */
export const READ_TIMEOUT_MS = 20_000;

export interface ScanApi {
  files: ReceiptScanFiles;
  engine: OcrEngine;
  newId(): string;
  /** The entry that already holds a photo with this digest, or null. */
  findByDigest(digest: string): Promise<string | null>;
  profile(): Promise<{ region: string; currency: string } | null>;
  timeoutMs?: number;
}

export const realScanApi: ScanApi = {
  files: realScanFiles,
  engine: realOcrEngine,
  newId: () => getServices().newId(),
  async findByDigest(digest) {
    const rows = await getServices().db.query('SELECT a.transaction_id FROM attachment a JOIN "transaction" t ON t.id = a.transaction_id WHERE a.digest = ? AND t.removed_at IS NULL LIMIT 1', [digest]);
    return rows.length > 0 ? String(rows[0]?.[0]) : null;
  },
  async profile() {
    const p = await readProfile(getServices().db);
    return p ? { region: p.regionCode, currency: p.currency } : null;
  },
};

export type IntakeOutcome = { kind: 'ready'; photo: PendingPhoto } | { kind: 'duplicate'; transactionId: string } | { kind: 'failed' };

/** Takes a chosen image in: one processed, encrypted copy, nothing else written. An image already saved as an attachment is not taken in. */
export async function intakePhoto(api: ScanApi, uri: string, provenance: PendingPhoto['provenance']): Promise<IntakeOutcome> {
  const attachmentId = api.newId();
  try {
    const out = await api.files.prepare(uri, attachmentId);
    const existing = await api.findByDigest(out.digest);
    if (existing) {
      await api.files.remove(attachmentId).catch(() => undefined);
      return { kind: 'duplicate', transactionId: existing };
    }
    return { kind: 'ready', photo: { attachmentId, digest: out.digest, sizeBytes: Math.max(1, Math.round(out.size)), width: out.width, height: out.height, provenance } };
  } catch {
    await api.files.remove(attachmentId).catch(() => undefined);
    return { kind: 'failed' };
  }
}

export type ReadOutcome = { kind: 'read'; draft: ReceiptDraft } | { kind: 'cancelled' } | { kind: 'failed'; reason: 'unreadable' | 'timeout' | 'unavailable' };

/** Reads one pending photo: decrypts a plain copy for the engine, recognises, parses, and removes the plain copy again. */
export async function readPhoto(api: ScanApi, photo: PendingPhoto, signal: AbortSignal, onPath?: (path: string) => void): Promise<ReadOutcome> {
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), api.timeoutMs ?? READ_TIMEOUT_MS);
  const onOuter = () => limit.abort();
  signal.addEventListener('abort', onOuter);
  try {
    if (signal.aborted) return { kind: 'cancelled' };
    const profile = await api.profile();
    if (!profile) return { kind: 'failed', reason: 'unavailable' };
    const path = await api.files.viewPath(photo.attachmentId);
    onPath?.(path);
    const ocr = await api.engine.recognise(path, limit.signal);
    const parsed = parseReceipt(ocr, { region: profile.region, profileCurrency: profile.currency });
    return parsed.ok ? { kind: 'read', draft: parsed.value } : { kind: 'failed', reason: 'unreadable' };
  } catch (e) {
    if (signal.aborted) return { kind: 'cancelled' };
    if (limit.signal.aborted) return { kind: 'failed', reason: 'timeout' };
    if (isOcrFailure(e) && e.code === 'CANCELLED') return { kind: 'cancelled' };
    return { kind: 'failed', reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuter);
    await api.files.clearViewCache().catch(() => undefined);
  }
}
