/**
 * OcrEngine port (AD-14, Story 10.1): reads text from one image on the phone and returns positioned text blocks. All receipt
 * parsing, reconciliation and allocation live in core; nothing about the engine (model, runtime, script) leaks past this port.
 * The chosen engine is PaddleOCR PP-OCRv4 on ONNX Runtime (decision record docs/decisions/S3-ocr-engine.md).
 */

/** A path to an image the app already holds (a private copy, never a gallery URI). */
export type FileRef = string;

/** One run of text with its box in image pixels (origin top-left, right and bottom are exclusive edges). */
export interface OcrBlock {
  readonly text: string;
  readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** 0 to 1, or null when the engine reports none. */
  readonly confidence: number | null;
}

export interface OcrResult {
  /** The pixel size of the image the boxes refer to. */
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly OcrBlock[];
}

/** The engine cannot run here (model missing or unreadable, runtime failed to start). Never a network problem: nothing is downloaded. */
export interface OcrUnavailable {
  readonly code: 'OCR_UNAVAILABLE';
  readonly detail?: string;
}

/** The engine runs, but this read failed (a bad image, not enough memory). Trying again may work. */
export interface OcrFailed {
  readonly code: 'OCR_FAILED';
  readonly detail?: string;
}

/** The caller aborted through the signal. */
export interface OcrCancelled {
  readonly code: 'CANCELLED';
}

export type OcrFailure = OcrUnavailable | OcrFailed | OcrCancelled;

export const OCR_UNAVAILABLE = 'OCR_UNAVAILABLE' as const;
export const OCR_FAILED = 'OCR_FAILED' as const;
export const CANCELLED = 'CANCELLED' as const;

/** True for the typed failures an engine rejects with. */
export function isOcrFailure(e: unknown): e is OcrFailure {
  return typeof e === 'object' && e !== null && [OCR_UNAVAILABLE, OCR_FAILED, CANCELLED].includes((e as { code?: unknown }).code as never);
}

export interface OcrEngine {
  /**
   * Rejects with an `OcrFailure`: `OCR_UNAVAILABLE` when the engine cannot run, `CANCELLED` when `signal` aborts. Blocks are line-level (one block per
   * printed line or line fragment), axis-aligned, in no guaranteed order: the parser orders them. An empty `blocks` list is a valid result (no text found); width and height are always above 0. If `signal` is already aborted on entry the
   * engine rejects with `CANCELLED` without starting inference. `OCR_FAILED` when one read fails; the adapter maps any other runtime error to it.
   */
  recognise(image: FileRef, signal: AbortSignal): Promise<OcrResult>;
}
