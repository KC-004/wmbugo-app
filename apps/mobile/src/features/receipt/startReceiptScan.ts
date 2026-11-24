/**
 * The one way into a receipt scan (Story 10.9, OCR-009). The Add sheet chip, the long-press on ＋, the entry detail, and (in Epics 11 and 12)
 * the widget, the capture notification and a shared image all call `startReceiptScan`, so they share one path through the lock, the camera
 * or intake, the reading and the review.
 *
 * It never opens anything outside the app's own navigator, and that navigator sits inside the LockGate, so a scan started from a link or a
 * notification asks for the lock first when app lock is on.
 */

export const SCAN_ORIGINS = ['add_sheet', 'plus_long_press', 'entry_detail', 'widget', 'share', 'notification'] as const;
export type ScanOrigin = (typeof SCAN_ORIGINS)[number];

export interface ScanRequest {
  readonly origin: ScanOrigin;
  /** The recorded entry the receipt will split (attach mode). */
  readonly attachTo?: string;
  /** An image the app already holds (a shared image): straight to intake and reading, no camera. */
  readonly imageUri?: string;
}

export interface ScanParams {
  readonly origin: ScanOrigin;
  readonly attachTo?: string;
  readonly uri?: string;
  readonly provenance?: 'photo_picker' | 'camera';
  readonly tempPath?: string;
}

export interface ScanNav {
  navigate(screen: 'ReceiptCamera' | 'ReceiptScan', params: ScanParams): void;
}

/** Opens the camera, or (with `imageUri`) goes straight to intake and reading. */
export function startReceiptScan(nav: ScanNav, request: ScanRequest): void {
  const base: ScanParams = { origin: request.origin, ...(request.attachTo ? { attachTo: request.attachTo } : {}) };
  if (request.imageUri) nav.navigate('ReceiptScan', { ...base, uri: request.imageUri, provenance: 'photo_picker' });
  else nav.navigate('ReceiptCamera', base);
}

/** `wmbugo://receipt/scan?attachTo=<id>` (optionally `&origin=widget`). Anything else is not a scan link. */
export function scanLinkRequest(url: string): ScanRequest | null {
  const m = /^wmbugo:\/\/receipt\/scan(?:\?(.*))?$/.exec(url.trim());
  if (!m) return null;
  const query = new Map<string, string>();
  for (const pair of (m[1] ?? '').split('&')) {
    const [k, v] = pair.split('=');
    if (k) query.set(decodeURIComponent(k), decodeURIComponent(v ?? ''));
  }
  const asked = query.get('origin');
  const origin = (SCAN_ORIGINS as readonly string[]).includes(asked ?? '') ? (asked as ScanOrigin) : 'widget';
  const attachTo = query.get('attachTo');
  return { origin, ...(attachTo ? { attachTo } : {}) };
}
