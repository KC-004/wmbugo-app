import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Attachment } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';

const THUMB = 72;

/** A decrypted temporary copy, fetched when the thumbnail shows. */
function usePhoto(id: string, path: ((id: string) => Promise<string>) | undefined): string | null {
  const q = useQuery({ queryKey: ['ledger', 'photo', id], queryFn: () => (path ? path(id) : Promise.reject(new Error('no photos'))), staleTime: Infinity, gcTime: 0 });
  return q.data ?? null;
}

function Thumb({ photo, photoPath, onOpen }: { photo: Attachment; photoPath?: (id: string) => Promise<string>; onOpen: () => void }) {
  const theme = useTheme();
  const uri = usePhoto(photo.id, photoPath);
  return (
    <Pressable testID={`photo-${photo.id}`} accessibilityRole="imagebutton" accessibilityLabel={copy.photo.open} onPress={onOpen} style={[styles.thumb, { backgroundColor: theme.color('bg-muted'), borderColor: theme.color('border-hairline') }]}>
      {uri ? <Image source={{ uri: `file://${uri}` }} style={styles.thumbImage} accessibilityIgnoresInvertColors /> : null}
    </Pressable>
  );
}

/**
 * The receipt photos of an entry: thumbnails (a tap opens the photo full screen), Add receipt photo, and Remove photo
 * behind a confirm sheet. Nothing else about the entry changes when a photo is added or removed.
 */
export function ReceiptPhotos({
  photos,
  photoPath,
  onAdd,
  onRemove,
}: {
  photos: readonly Attachment[];
  photoPath?: (id: string) => Promise<string>;
  onAdd?: () => void;
  onRemove?: (attachmentId: string) => Promise<void>;
}) {
  const theme = useTheme();
  const sheet = useSheet();
  const [open, setOpen] = useState<Attachment | null>(null);
  const viewing = usePhoto(open?.id ?? '', open ? photoPath : undefined);

  const confirmRemove = (p: Attachment) => {
    setOpen(null);
    sheet.open({
      id: 'remove-photo',
      title: copy.photo.remove,
      body: (close) => (
        <View testID="remove-photo-sheet" style={styles.sheet}>
          <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{copy.photo.removeSheet}</Text>
          <Button
            label={copy.photo.remove}
            testID="remove-photo-confirm"
            onPress={() => {
              close();
              void onRemove?.(p.id);
            }}
          />
          <Button label={copy.common.cancel} variant="text" onGlass onPress={close} testID="remove-photo-cancel" />
        </View>
      ),
    });
  };

  return (
    <View testID="receipt-photos" style={styles.wrap}>
      {photos.length > 0 ? (
        <View style={styles.thumbs}>
          {photos.map((p) => (
            <Thumb key={p.id} photo={p} photoPath={photoPath} onOpen={() => setOpen(p)} />
          ))}
        </View>
      ) : null}
      {onAdd ? <Button label={copy.photo.add} variant="secondary" onPress={onAdd} testID="photo-add" /> : null}
      <Modal visible={open !== null} animationType="fade" onRequestClose={() => setOpen(null)} transparent={false}>
        <View testID="photo-viewer" style={[styles.viewer, { backgroundColor: theme.color('bg-canvas') }]}>
          {viewing ? <Image source={{ uri: `file://${viewing}` }} style={styles.full} resizeMode="contain" accessibilityLabel={copy.photo.thumb} /> : null}
          <View style={styles.viewerActions}>
            <Button label={copy.photo.close} variant="secondary" onPress={() => setOpen(null)} testID="photo-close" />
            {open && onRemove ? <Button label={copy.photo.remove} variant="text" onPress={() => confirmRemove(open)} testID="photo-remove" /> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignItems: 'flex-start' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: THUMB, height: THUMB, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  thumbImage: { width: THUMB, height: THUMB },
  sheet: { gap: 12 },
  viewer: { flex: 1, padding: 16, gap: 16 },
  full: { flex: 1 },
  viewerActions: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
});
