/**
 * Tab navigation timing for NFR-03 (median under 300 ms on the reference device; method in
 * docs/decisions/S8-reference-devices.md). A tab press is marked; when the target screen has drawn
 * its first frame the elapsed time is reported to the sink (the app wires it to the redacting logger).
 */
export type NavTimingSink = (event: { tab: string; durationMs: number }) => void;

let sink: NavTimingSink | null = null;
const pending = new Map<string, number>();
let nowFn: () => number = () => Date.now();

export function setNavTimingSink(next: NavTimingSink | null, now: () => number = () => Date.now()): void {
  sink = next;
  nowFn = now;
}

export function markTabPress(tab: string): void {
  pending.set(tab, nowFn());
}

/** Called by a tab screen after its first frame. Ignored when the tab was not pressed (first mount). */
export function markTabFirstFrame(tab: string): void {
  const start = pending.get(tab);
  if (start === undefined) return;
  pending.delete(tab);
  sink?.({ tab, durationMs: nowFn() - start });
}
