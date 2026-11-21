import type { ReactNode } from 'react';

/** An on-device parser that can be tried on sample text typed into Diagnostics (registered by later epics, such as SMS and UPI). */
export interface ParserEntry {
  readonly id: string;
  readonly label: string;
  /** Runs on the typed sample only. The sample is never stored or logged; the result is shown on screen and then forgotten. */
  run(sample: string): string;
}

/** An extra block on the Diagnostics screen (the `Background capture` slot reserved for Epic 13's OEM help). */
export interface DiagnosticsSection {
  readonly id: string;
  readonly title: string;
  render(): ReactNode;
}

const parsers = new Map<string, ParserEntry>();
const sections = new Map<string, DiagnosticsSection>();

export const registerParser = (p: ParserEntry): void => void parsers.set(p.id, p);
export const listParsers = (): ParserEntry[] => [...parsers.values()];
export const registerDiagnosticsSection = (s: DiagnosticsSection): void => void sections.set(s.id, s);
export const listDiagnosticsSections = (): DiagnosticsSection[] => [...sections.values()];

/** Test hook. */
export function clearDiagnosticsRegistry(): void {
  parsers.clear();
  sections.clear();
}
