import type { DiagnosticsStatus } from '@wmbugo/core';

export interface DiagnosticsApi {
  status(): Promise<DiagnosticsStatus>;
  /** The full redacted report text: exactly what is previewed and, with consent, saved. */
  report(): Promise<string>;
  /** The save dialog; `cancelled` writes nothing. */
  save(text: string): Promise<'saved' | 'cancelled' | 'failed'>;
}

export const realDiagnosticsApi: DiagnosticsApi = {
  async status() {
    return (await import('../../adapters/diagnostics')).readStatus();
  },
  async report() {
    return (await import('../../adapters/diagnostics')).buildReport();
  },
  async save(text) {
    return (await import('../../adapters/diagnostics')).saveReport(text);
  },
};
