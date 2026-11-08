import { useCallback, type RefObject } from 'react';
import { useNavigation } from '@react-navigation/native';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { AddSheet } from './AddSheet';

/** Opens the Add sheet (one at a time); focus returns to `opener` when it closes. */
export function useOpenAdd(opener?: RefObject<unknown>): () => void {
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
            onNewAccount={() => {
              close();
              nav.navigate('Accounts');
            }}
          />
        ),
      },
      opener,
    );
  }, [sheet, nav, opener]);
}
