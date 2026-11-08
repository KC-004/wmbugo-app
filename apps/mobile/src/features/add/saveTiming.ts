/**
 * Save timing for NFR-04 (p95 under 500 ms on the reference device; method in docs/decisions/S8-reference-devices.md):
 * from the moment validation has passed to the moment the confirmation toast has been shown. The app wires the
 * sink to the redacting logger; only the kind and a duration are reported.
 */
export type SaveTimingSink = (event: { kind: string; durationMs: number }) => void;

let sink: SaveTimingSink | null = null;

const clock = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export function setSaveTimingSink(next: SaveTimingSink | null): void {
  sink = next;
}

/** Starts a measurement; call the returned function when the toast is up. */
export function startSaveTiming(kind: string): () => void {
  const t0 = clock();
  return () => sink?.({ kind, durationMs: Math.round((clock() - t0) * 10) / 10 });
}
