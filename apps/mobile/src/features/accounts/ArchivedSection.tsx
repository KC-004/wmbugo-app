import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { accountLine, type AccountRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { TYPE_LABEL } from './AccountForm';

/** A collapsed "Archived (n)" row. Opened, each account shows its final balance with Open (its read-only page) and Restore. */
export function ArchivedSection({
  rows,
  currency,
  locale,
  onOpen,
  onRestore,
}: {
  rows: readonly AccountRow[];
  currency?: CurrencyCode;
  locale?: string;
  onOpen: (id: string) => void;
  onRestore: (id: string) => void | Promise<void>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const label = copy.archive.archivedRow.replace('{n}', String(rows.length));
  return (
    <View testID="archived-section" style={styles.group}>
      <Pressable testID="archived-toggle" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={styles.toggle}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-secondary') }]}>{label}</Text>
      </Pressable>
      {open
        ? rows.map((a) => {
            const line = accountLine(a);
            const words = line.kind === 'owe' ? copy.accounts.youOwe : line.kind === 'below-zero' ? copy.accounts.belowZero : line.kind === 'in-credit' ? copy.accounts.inCredit : '';
            const spoken =
              line.kind === 'not-set' || !currency
                ? copy.money.balanceNotSet
                : line.kind === 'moved-in'
                  ? `${amountLabel({ amountMinor: line.minor, currency, locale })} ${copy.accounts.movedIn.toLowerCase()}`
                  : [words, amountLabel({ amountMinor: line.minor, currency, locale })].filter(Boolean).join(' ');
            return (
              <View
                key={a.id}
                testID={`archived-row-${a.id}`}
                accessible
                accessibilityLabel={`${a.name}, ${TYPE_LABEL[a.type]}, ${copy.accounts.archived.toLowerCase()}, ${spoken}`}
                accessibilityActions={[
                  { name: 'open', label: copy.accountDetail.open },
                  { name: 'restore', label: copy.archive.restore },
                ]}
                onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'open' ? onOpen(a.id) : void onRestore(a.id))}
                style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
                <View style={styles.main}>
                  <View style={styles.text}>
                    <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{a.name}</Text>
                    <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{TYPE_LABEL[a.type]}</Text>
                  </View>
                  {line.kind === 'not-set' || !currency ? (
                    <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.money.balanceNotSet}</Text>
                  ) : line.kind === 'moved-in' && line.minor === 0 ? (
                    <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.nothingMovedIn}</Text>
                  ) : (
                    <Amount amountMinor={line.minor} currency={currency} direction="neutral" locale={locale} />
                  )}
                </View>
                <View style={styles.actions}>
                  <Button label={copy.accountDetail.open} variant="text" onPress={() => onOpen(a.id)} testID={`archived-open-${a.id}`} />
                  <Button label={copy.archive.restore} variant="text" onPress={() => void onRestore(a.id)} testID={`archived-restore-${a.id}`} />
                </View>
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  toggle: { minHeight: 48, justifyContent: 'center' },
  row: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
