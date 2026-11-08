import { useCallback, type RefObject } from 'react';
import { useNavigation } from '@react-navigation/native';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useOpenSplit } from '../activity/useOpenSplit';
import { AddSheet, type AddPreset, type EditSpec } from './AddSheet';

/** Opens the Add sheet with a preset chosen at the moment of the tap (one at a time). */
export function useOpenAddWith(opener?: RefObject<unknown>): (preset?: AddPreset, edit?: EditSpec) => void {
  const sheet = useSheet();
  const openSplit = useOpenSplit();
  const nav = useNavigation<{ navigate: (s: 'Accounts') => void }>();
  return useCallback(
    (preset?: AddPreset, edit?: EditSpec) => {
      sheet.open(
        {
          id: 'add',
          title: edit ? copy.sheet.editTitle : copy.sheet.addTitle,
          body: (close) => (
            <AddSheet
              close={close}
              preset={preset}
              edit={edit}
              onSplit={(id, amount) => openSplit(id, amount)}
              onNewAccount={() => {
                close();
                nav.navigate('Accounts');
              }}
            />
          ),
        },
        opener,
      );
    },
    [sheet, nav, opener, openSplit],
  );
}

/**
 * Opens the Add sheet (one at a time); focus returns to `opener` when it closes. With a `preset` (opened from an
 * account) the sheet starts on that type with that account chosen.
 */
export function useOpenAdd(opener?: RefObject<unknown>, preset?: AddPreset): () => void {
  const open = useOpenAddWith(opener);
  return useCallback(() => open(preset), [open, preset]);
}
