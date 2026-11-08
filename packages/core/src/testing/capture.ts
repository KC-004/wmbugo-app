import type { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import type { ManualEntry } from '../ledger/entryCommands';
import type { TransferInput } from '../ledger/transferCommands';

/** TEST ONLY: submits a manual entry or transfer through the one capture path with a fresh submission id. */
let n = 0;
const id = () => `test-submission-${++n}`;

export const entryInput = (entry: ManualEntry, submissionId = id()) => ({ submissionId, sourceKind: 'manual' as const, entry });
export const transferInput = (transfer: TransferInput, submissionId = id()) => ({ submissionId, sourceKind: 'manual' as const, transfer });

export const recordEntry = (writer: LedgerWriter, entry: ManualEntry, submissionId?: string) => writer.run(SubmitCapture, entryInput(entry, submissionId), 'user');
export const recordTransfer = (writer: LedgerWriter, transfer: TransferInput, submissionId?: string) => writer.run(SubmitCapture, transferInput(transfer, submissionId), 'user');
