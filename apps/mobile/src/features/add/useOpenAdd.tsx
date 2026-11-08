import { useCallback, type RefObject } from 'react';
import { useNavigation } from '@react-navigation/native';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { AddSheet } from './AddSheet';
import type { AddKind } from './addApi';

/**
 * Opens the Add sheet (one at a time); focus returns to `opener` when it closes. With a `preset` (opened from an
 * account) the sheet starts on that type with that account chosen.
 */
export function useOpenAdd(opener?: RefObject<unknown>, preset?: { kind: AddKind; accountId: string }): () => void {
  const sheet = useSheet();
  const nav = useNavigation<{ navigate: (s: 'Accounts') => void }>();
  return useCallback(() => {
    sheet.open(
      {
        id: 'add',
        title: copy.sheet.addTitle,
        body: (close) => (
          <AddSheet
            close={close}
            preset={preset}
            onNewAccount={() => {
              close();
              nav.navigate('Accounts');
            }}
          />
        ),
      },
      opener,
    );
  }, [sheet, nav, opener, preset?.kind, preset?.accountId]);
}
