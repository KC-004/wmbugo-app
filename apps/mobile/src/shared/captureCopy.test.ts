import { CAPTURE_LABEL_KEYS, CAPTURE_STATES, captureStatusLabel } from '@wmbugo/core';
import { copy } from './copy';

describe('capture status copy (UX-DR82)', () => {
  it('every capture state has its words in the catalogue, exactly as specified', () => {
    for (const state of CAPTURE_STATES) expect(copy.capture[captureStatusLabel(state)]).toBeTruthy();
    expect(CAPTURE_LABEL_KEYS.map((k) => copy.capture[k])).toEqual([
      'Recorded',
      'Recorded · category guessed',
      'Recorded · needs a category',
      'Recorded · linked as transfer',
      'Waiting for you',
      'Possible duplicate — check it',
      'Looks like a scam — not added',
      'Rejected',
    ]);
  });
});
