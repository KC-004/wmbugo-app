import type { SubmitResult } from './submitCapture';

/**
 * How a captured item reads to the user (UX-DR82). The states are exhaustive: adding one without copy fails the
 * compiler here and the catalogue test in the app. A possible duplicate is never stored on a transaction; it is derived
 * from an open review candidate with reason duplicate.
 */
export type CaptureState =
  | 'recorded'
  | 'recorded_category_guessed'
  | 'recorded_needs_category'
  | 'recorded_linked_transfer'
  | 'waiting'
  | 'possible_duplicate'
  | 'scam_blocked'
  | 'rejected';

export const CAPTURE_STATES: readonly CaptureState[] = [
  'recorded',
  'recorded_category_guessed',
  'recorded_needs_category',
  'recorded_linked_transfer',
  'waiting',
  'possible_duplicate',
  'scam_blocked',
  'rejected',
];

/** Keys into the app's copy catalogue (`copy.capture.<key>`); the words live there, not in core. */
export type CaptureLabelKey = 'recorded' | 'recordedGuessed' | 'recordedNeedsCategory' | 'recordedLinked' | 'waiting' | 'possibleDuplicate' | 'scam' | 'rejected';

export const CAPTURE_LABEL_KEYS: readonly CaptureLabelKey[] = ['recorded', 'recordedGuessed', 'recordedNeedsCategory', 'recordedLinked', 'waiting', 'possibleDuplicate', 'scam', 'rejected'];

export function captureStatusLabel(state: CaptureState): CaptureLabelKey {
  switch (state) {
    case 'recorded':
      return 'recorded';
    case 'recorded_category_guessed':
      return 'recordedGuessed';
    case 'recorded_needs_category':
      return 'recordedNeedsCategory';
    case 'recorded_linked_transfer':
      return 'recordedLinked';
    case 'waiting':
      return 'waiting';
    case 'possible_duplicate':
      return 'possibleDuplicate';
    case 'scam_blocked':
      return 'scam';
    case 'rejected':
      return 'rejected';
  }
}

/** Every capture result code maps to a state, so no result reaches the screen without words. */
export function captureStateOfResult(code: SubmitResult): CaptureState {
  switch (code) {
    case 'RECORDED':
    case 'ALREADY_SUBMITTED':
      return 'recorded';
    case 'POSSIBLE_DUPLICATE':
      return 'possible_duplicate';
  }
}

/** The state of a stored transaction: its status and resolution, whether it needs a category, and any open duplicate candidate. */
export function captureStateOf(t: {
  readonly status: 'draft' | 'needs_review' | 'confirmed' | 'excluded' | 'reversed';
  readonly resolution: 'user_approved' | 'auto_approved' | 'auto_linked' | 'rejected' | null;
  readonly needsCategory: boolean;
  readonly categoryGuessed?: boolean;
  readonly openDuplicate: boolean;
}): CaptureState {
  if (t.resolution === 'rejected' || t.status === 'excluded') return 'rejected';
  if (t.openDuplicate) return 'possible_duplicate';
  if (t.status === 'needs_review' || t.status === 'draft') return 'waiting';
  if (t.resolution === 'auto_linked') return 'recorded_linked_transfer';
  if (t.needsCategory) return 'recorded_needs_category';
  if (t.categoryGuessed) return 'recorded_category_guessed';
  return 'recorded';
}
