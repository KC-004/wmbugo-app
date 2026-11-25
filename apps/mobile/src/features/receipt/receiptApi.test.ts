import { SaveReceipt } from '@wmbugo/core';
import { readProfile } from '../../adapters/readProfile';
import { getServices } from '../../adapters/startApp';
import { realReceiptApi } from './receiptApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));
jest.mock('../../adapters/readProfile', () => ({ readProfile: jest.fn() }));

const run = jest.fn(async () => ({ ok: true, value: { transactionId: 't', result: 'RECORDED' } }));

beforeEach(() => {
  jest.clearAllMocks();
  (getServices as jest.Mock).mockReturnValue({ writer: { run }, db: { query: jest.fn(async () => []) } });
  (readProfile as jest.Mock).mockResolvedValue({ currency: 'SGD', exponent: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore' });
});

describe('realReceiptApi', () => {
  it('has no default account on an empty ledger', async () => {
    expect(await realReceiptApi.load('Shop')).toMatchObject({ defaultAccountId: null, cashAccountId: null, quick: [] });
  });

  it('forwards Cash creation, the photo and Keep separate to SaveReceipt', async () => {
    const attachment = { attachmentId: 'a', digest: 'd', sizeBytes: 1 };
    await realReceiptApi.save({ submissionId: 's', draft: {} as never, itemCategories: [], mainCategoryId: 'c', accountId: null, createCash: true, attachment, keepSeparate: true });
    expect(run).toHaveBeenCalledWith(SaveReceipt, expect.objectContaining({ createCash: true, attachment, keepSeparate: true }), 'user');
  });
});
