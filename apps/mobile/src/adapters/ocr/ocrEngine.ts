import { NativeModules } from 'react-native';
import { CANCELLED, isOcrFailure, OCR_FAILED, OCR_UNAVAILABLE, type FileRef, type OcrEngine, type OcrResult } from '@wmbugo/core';

/** What the native engine module offers. It is absent until the PaddleOCR / ONNX engine of Story 10.1's decision is built into the app. */
interface NativeOcr {
  recognise(path: string): Promise<{ width: number; height: number; blocks: { text: string; left: number; top: number; right: number; bottom: number; confidence: number | null }[] }>;
  cancel(): Promise<void>;
}

/** The OcrEngine adapter (AD-14). With no native engine it says `OCR_UNAVAILABLE` honestly: it never invents text and never downloads a model. */
export function createOcrEngine(native: () => NativeOcr | undefined = () => NativeModules.WmbugoOcr as NativeOcr | undefined): OcrEngine {
  return {
    async recognise(image: FileRef, signal: AbortSignal): Promise<OcrResult> {
      if (signal.aborted) throw { code: CANCELLED };
      const module = native();
      if (!module) throw { code: OCR_UNAVAILABLE, detail: 'No engine in this build' };
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          void module.cancel().catch(() => undefined);
          reject({ code: CANCELLED });
        };
        signal.addEventListener('abort', onAbort);
      });
      try {
        const out = await Promise.race([module.recognise(image), aborted]);
        if (!(out.width > 0) || !(out.height > 0)) throw { code: OCR_UNAVAILABLE, detail: 'Bad image size' };
        return {
          width: out.width,
          height: out.height,
          blocks: out.blocks.map((b) => ({ text: b.text, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, confidence: b.confidence })),
        };
      } catch (e) {
        if (isOcrFailure(e)) throw e;
        const detail = e instanceof Error ? e.message : 'Engine failed';
        // Only a model that is missing or will not load means this phone cannot read receipts.
        throw { code: (e as { code?: unknown } | null)?.code === 'E_UNAVAILABLE' ? OCR_UNAVAILABLE : OCR_FAILED, detail };
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

export const realOcrEngine: OcrEngine = createOcrEngine();
