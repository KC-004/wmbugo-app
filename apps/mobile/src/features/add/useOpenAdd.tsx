import { useCallback, type RefObject } from 'react';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { AddSheet } from './AddSheet';

/** Opens the Add sheet (one at a time); focus returns to `opener` when it closes. */
export function useOpenAdd(opener?: RefObject<unknown>): () => void {
  const sheet = useSheet();
  return useCallback(() => {
    sheet.open({ id: 'add', title: copy.sheet.addTitle, body: (close) => <AddSheet close={close} /> }, opener);
  }, [sheet, opener]);
}
