import { useCallback } from 'react';
import {
  ACCOUNT_LIST_SQL,
  CARD_DETAILS_SQL,
  LAST_ACCOUNT_SQL,
  LAST_PAYER_SQL,
  cardPosition,
  mapAccountRows,
  mapCardDetails,
  payBillAmount,
  pickPayerAccount,
  toLocalDate,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { copy } from '../../shared/copy';
import type { AddPreset } from '../add/AddSheet';
import { useOpenAddWith } from '../add/useOpenAdd';

/**
 * The ready-filled transfer for paying a card (Story 2.7): To is the card, the amount is the unpaid statement or else
 * what is owed (empty with a hint when nothing is), and From is the asset account that last paid this card, else the
 * Settings default, else the most recently used asset account. null when the card or profile cannot be read.
 */
export async function payBillPreset(cardId: string): Promise<AddPreset | null> {
  const db = getServices().db;
  const profile = await readProfile(db);
  if (!profile) return null;
  const rows = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const card = rows.find((r) => r.id === cardId && r.type === 'card');
  if (!card) return null;
  const today = toLocalDate(systemClock.nowMs(), profile.timezoneId);
  if (!today.ok) return null;

  const position = cardPosition(card);
  const owed = position.kind === 'owed' ? position.outstandingMinor : 0;
  const { amountMinor, nothingOwed } = payBillAmount(mapCardDetails(await db.query(CARD_DETAILS_SQL, [cardId])), today.value, owed);

  const assetIds = rows.filter((r) => r.status === 'active' && r.type !== 'card').map((r) => r.id);
  const lastPayer = ((await db.query(LAST_PAYER_SQL, [cardId]))[0]?.[0] as string | undefined) ?? null;
  const lastUsed = ((await db.query(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;
  return {
    kind: 'transfer',
    accountId: pickPayerAccount(assetIds, lastPayer, profile.settings.defaultAccountId, lastUsed),
    toAccountId: cardId,
    lockTo: true,
    amountMinor,
    owedMinor: owed,
    ...(nothingOwed ? { hint: copy.add.nothingOwed } : {}),
  };
}

/** Returns a function that opens the Pay card bill sheet for a card. */
export function usePayBill(): (cardId: string) => void {
  const open = useOpenAddWith();
  return useCallback(
    (cardId: string) => {
      void payBillPreset(cardId).then((preset) => preset && open(preset));
    },
    [open],
  );
}
