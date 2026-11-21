import type { Logger } from '../shared/logger';

/** The fixture entry of Story 8.1: values that must never reach a log, a crash record or the Diagnostics export (Story 8.10). */
export const REDACTION_FIXTURE_VALUES = ['1,18,600', '118600', 'Swiggy Instamart', 'rent for Feb', 'HDFC ••4821', '••4821', '4821', 'sara@okhdfc', '/data/user/0/app.wmbugo/files/receipts/a.jpg', 'Your A/c XX4821 debited by Rs 1,18,600'];

export function logFixtureEntry(logger: Logger): void {
  logger.info('entry.saved', {
    amountMinor: 11860000,
    amount: '₹1,18,600',
    merchant: 'Swiggy Instamart',
    note: 'rent for Feb',
    account: 'HDFC ••4821',
    upi: 'sara@okhdfc',
    image: '/data/user/0/app.wmbugo/files/receipts/a.jpg',
    smsBody: 'Your A/c XX4821 debited by Rs 1,18,600 to sara@okhdfc',
    durationMs: 42,
    code: 'OK',
    entryCount: 3,
  });
  logger.error('save.failed', {
    code: 'WRITE_FAILED',
    errorMessage: 'could not save ₹1,18,600 from ••4821 (sara@okhdfc) a/c no. 4821, ref 998877',
  });
}
