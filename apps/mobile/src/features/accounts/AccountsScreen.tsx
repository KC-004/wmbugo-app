import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bank, CreditCard, Money, PiggyBank, Wallet } from 'phosphor-react-native';
import { balanceOf, cardDues, validateAccountName, type AccountRow, type CurrencyCode, type NewAccount } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { Icon, type IconComponent } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { AccountForm, TYPE_LABEL } from './AccountForm';
import { ACCOUNTS_QUERY_KEY, PROFILE_QUERY_KEY, realAccountsApi, type AccountsApi } from './accountsApi';

const ICONS: Readonly<Record<string, IconComponent>> = { Money, Bank, Wallet, PiggyBank, CreditCard };

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'rename'; account: AccountRow };

/**
 * The accounts list: active accounts in Mei's order with a ledger-derived balance or "Balance not set"
 * (never zero), add, rename, Move up / Move down (also TalkBack custom actions) and archive with Undo.
 */
export function AccountsScreen({ api = realAccountsApi }: { api?: AccountsApi }) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ACCOUNTS_QUERY_KEY, queryFn: () => api.list() });
  const profile = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.profile() });
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['ledger'] });
  const active = (accounts.data ?? []).filter((a) => a.status === 'active');
  const ink = { color: theme.color('text-primary') };

  const add = async (account: NewAccount) => {
    const r = await api.add(account);
    if (r.ok) {
      setSaveError(null);
      setMode({ kind: 'list' });
      await refresh();
    } else setSaveError(copy.accounts.saveError);
  };

  const archive = async (a: AccountRow) => {
    const r = await api.archive(a.id);
    if (!r.ok) return;
    await refresh();
    toast.show({
      message: `${copy.accounts.archived} ${a.name}`,
      undo: {
        label: copy.common.undo,
        onUndo: () => void api.restore(a.id).then(refresh),
      },
    });
  };

  const move = async (a: AccountRow, direction: 'up' | 'down') => {
    await api.move(a.id, direction);
    await refresh();
  };

  if (mode.kind === 'add' && profile.data) {
    return (
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{copy.accounts.add}</Text>
        <AccountForm exponent={profile.data.exponent} submitLabel={copy.accounts.save} onSubmit={add} saveError={saveError} />
        <Button label={copy.common.cancel} variant="text" onPress={() => setMode({ kind: 'list' })} testID="account-cancel" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{copy.accounts.title}</Text>
        <Button label={copy.accounts.add} variant="secondary" onPress={() => setMode({ kind: 'add' })} testID="accounts-add" />
      </View>

      {active.length === 0 && !accounts.isLoading ? (
        <EmptyState sentence={copy.accounts.empty} actionLabel={copy.accounts.add} onAction={() => setMode({ kind: 'add' })} />
      ) : null}

      {active.map((a, i) => (
        <AccountRowView
          key={a.id}
          account={a}
          currency={profile.data?.currency}
          locale={profile.data?.locale}
          isFirst={i === 0}
          isLast={i === active.length - 1}
          editing={mode.kind === 'rename' && mode.account.id === a.id}
          onMove={(d) => void move(a, d)}
          onArchive={() => void archive(a)}
          onRename={() => setMode({ kind: 'rename', account: a })}
          onRenameSubmit={async (name) => {
            const r = await api.rename(a.id, name);
            if (r.ok) {
              setMode({ kind: 'list' });
              await refresh();
            }
            return r.ok;
          }}
          onRenameCancel={() => setMode({ kind: 'list' })}
        />
      ))}
    </ScrollView>
  );
}

function AccountRowView(props: {
  account: AccountRow;
  currency?: CurrencyCode;
  locale?: string;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  onMove: (d: 'up' | 'down') => void;
  onArchive: () => void;
  onRename: () => void;
  onRenameSubmit: (name: string) => Promise<boolean>;
  onRenameCancel: () => void;
}) {
  const { account: a, currency, locale, isFirst, isLast, editing } = props;
  const theme = useTheme();
  const [name, setName] = useState(a.name);
  const [error, setError] = useState(false);

  const balance = balanceOf(a);
  const dues = a.type === 'card' ? cardDues(a) : null;
  const shown = dues ?? balance;
  const spoken =
    shown.kind === 'not-set' || !currency
      ? copy.money.balanceNotSet
      : `${amountLabel({ amountMinor: shown.minor, currency, locale })}${dues ? ` ${copy.accounts.cardOwed.toLowerCase()}` : ''}`;
  const label = `${a.name}, ${TYPE_LABEL[a.type]}, ${spoken}`;

  const actions = [
    ...(isFirst ? [] : [{ name: 'moveUp', label: copy.accounts.moveUp }]),
    ...(isLast ? [] : [{ name: 'moveDown', label: copy.accounts.moveDown }]),
    { name: 'rename', label: copy.accounts.rename },
    { name: 'archive', label: copy.accounts.archive },
  ];

  return (
    <View
      testID={`account-row-${a.id}`}
      accessible={!editing}
      accessibilityLabel={label}
      accessibilityActions={actions}
      onAccessibilityAction={(e) => {
        const n = e.nativeEvent.actionName;
        if (n === 'moveUp') props.onMove('up');
        else if (n === 'moveDown') props.onMove('down');
        else if (n === 'rename') props.onRename();
        else if (n === 'archive') props.onArchive();
      }}
      style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.rowMain}>
        <Icon icon={ICONS[a.icon] ?? Wallet} color={a.colorToken as ColorName} size={28} />
        <View style={styles.rowText}>
          {editing ? (
            <>
              <TextInput
                testID="rename-input"
                accessibilityLabel={copy.accounts.nameLabel}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError(false);
                }}
                autoFocus
                style={[styles.input, textStyle('body'), { color: theme.color('text-primary'), borderColor: theme.color(error ? 'semantic-expense' : 'border-control') }]}
              />
              {error ? (
                <Text testID="rename-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
                  {copy.accounts.nameRequired}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{a.name}</Text>
              <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{TYPE_LABEL[a.type]}</Text>
            </>
          )}
        </View>
        {!editing ? (
          shown.kind === 'not-set' || !currency ? (
            <Text testID={`balance-${a.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.money.balanceNotSet}</Text>
          ) : (
            <View testID={`balance-${a.id}`} style={styles.balance}>
              <Amount amountMinor={shown.minor} currency={currency} direction="neutral" locale={locale} />
              {dues ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.cardOwed}</Text> : null}
            </View>
          )
        ) : null}
      </View>

      <View style={styles.actions}>
        {editing ? (
          <>
            <Button
              label={copy.accounts.renameSave}
              testID="rename-save"
              onPress={() => {
                if (!validateAccountName(name).ok) {
                  setError(true);
                  return;
                }
                void props.onRenameSubmit(name);
              }}
            />
            <Button label={copy.common.cancel} variant="text" onPress={props.onRenameCancel} testID="rename-cancel" />
          </>
        ) : (
          <>
            {isFirst ? null : <Button label={copy.accounts.moveUp} variant="text" onPress={() => props.onMove('up')} testID={`move-up-${a.id}`} />}
            {isLast ? null : <Button label={copy.accounts.moveDown} variant="text" onPress={() => props.onMove('down')} testID={`move-down-${a.id}`} />}
            <Button label={copy.accounts.rename} variant="text" onPress={props.onRename} testID={`rename-${a.id}`} />
            <Button label={copy.accounts.archive} variant="text" onPress={props.onArchive} testID={`archive-${a.id}`} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  balance: { alignItems: 'flex-end' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
