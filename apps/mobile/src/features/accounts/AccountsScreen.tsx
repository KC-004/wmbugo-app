import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bank, CreditCard, Money, PiggyBank, Wallet } from 'phosphor-react-native';
import { accountGroups, accountLine, validateAccountName, type AccountGroup, type AccountLineView, type AccountRow, type CurrencyCode, type GroupTotalView, type NewAccount, notSetNote } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { Icon, type IconComponent } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader } from '../shell/ScreenHeader';
import { AccountForm, TYPE_LABEL } from './AccountForm';
import { ACCOUNTS_QUERY_KEY, NET_WORTH_QUERY_KEY, PROFILE_QUERY_KEY, realAccountsApi, type AccountsApi } from './accountsApi';

const ICONS: Readonly<Record<string, IconComponent>> = { Money, Bank, Wallet, PiggyBank, CreditCard };

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'rename'; account: AccountRow };

/**
 * The accounts list: active accounts in Mei's order with a ledger-derived balance or "Balance not set"
 * (never zero), add, rename, Move up / Move down (also TalkBack custom actions) and archive with Undo.
 */
export function AccountsScreen({
  api = realAccountsApi,
  onOpen,
  onBack,
  onPayBill,
}: {
  api?: AccountsApi;
  onOpen?: (accountId: string) => void;
  onBack?: () => void;
  onPayBill?: (cardId: string) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ACCOUNTS_QUERY_KEY, queryFn: () => api.list() });
  const profile = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.profile() });
  const netWorthOn = useQuery({ queryKey: NET_WORTH_QUERY_KEY, queryFn: () => api.showNetWorth() });
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['ledger'] });
  const active = (accounts.data ?? []).filter((a) => a.status === 'active');
  const groups = accountGroups(active);

  const adding = useRef(false);
  const add = async (account: NewAccount) => {
    if (adding.current) return;
    adding.current = true;
    let r: { ok: boolean };
    try {
      r = await api.add(account);
    } finally {
      adding.current = false;
    }
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
        onUndo: () =>
          void api
            .restore(a.id)
            .then(async (res) => {
              await refresh();
              if (!res.ok) toast.show({ message: copy.accounts.restoreFailed });
            })
            .catch(() => toast.show({ message: copy.accounts.restoreFailed })),
      },
    });
  };

  const setInclusion = async (a: AccountRow, include: boolean) => {
    const r = await api.setInclusion(a.id, include);
    if (!r.ok) toast.show({ message: copy.accounts.inclusionFailed });
    await refresh();
  };

  const setNetWorth = async (on: boolean) => {
    const r = await api.setShowNetWorth(on);
    if (!r.ok) toast.show({ message: copy.accounts.inclusionFailed });
    await qc.invalidateQueries({ queryKey: NET_WORTH_QUERY_KEY });
  };

  const move = async (a: AccountRow, direction: 'up' | 'down') => {
    await api.move(a.id, direction);
    await refresh();
  };

  if (mode.kind === 'add' && profile.data) {
    return (
      <View style={styles.fill}>
        <ScreenHeader title={copy.accounts.add} onBack={() => setMode({ kind: 'list' })} backTestID="account-back" />
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <AccountForm exponent={profile.data.exponent} submitLabel={copy.accounts.save} onSubmit={add} saveError={saveError} />
          <Button label={copy.common.cancel} variant="text" onPress={() => setMode({ kind: 'list' })} testID="account-cancel" />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={copy.accounts.title}
        onBack={onBack}
        backTestID="accounts-back"
        actions={<Button label={copy.accounts.add} variant="secondary" onPress={() => setMode({ kind: 'add' })} testID="accounts-add" />}
      />
      <ScrollView contentContainerStyle={styles.pad}>

      {accounts.isError ? (
        <ErrorBlock cause={copy.accounts.loadError} onRetry={() => void accounts.refetch()} />
      ) : accounts.isLoading ? (
        <View testID="accounts-skeleton" style={styles.pad}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : null}

      {active.length === 0 && !accounts.isLoading && !accounts.isError ? (
        <EmptyState sentence={copy.accounts.empty} actionLabel={copy.accounts.add} onAction={() => setMode({ kind: 'add' })} />
      ) : null}

      {active.length > 0 ? (
        <>
          {([['have', copy.accounts.haveGroup, groups.have], ['owe', copy.accounts.oweGroup, groups.owe]] as const).map(([key, title, g]) =>
            g.rows.length === 0 ? null : (
              <View key={key} testID={`group-${key}`} style={styles.group}>
                <GroupHeader testID={`group-${key}-header`} title={title} group={g} currency={profile.data?.currency} locale={profile.data?.locale} kind={key === 'owe' ? 'card' : 'account'} />
                {g.rows.map((a, i) => (
                  <AccountRowView
                    key={a.id}
                    account={a}
                    currency={profile.data?.currency}
                    locale={profile.data?.locale}
                    isFirst={i === 0}
                    isLast={i === g.rows.length - 1}
                    editing={mode.kind === 'rename' && mode.account.id === a.id}
                    onMove={(d) => void move(a, d)}
                    onArchive={() => void archive(a)}
                    onRename={() => setMode({ kind: 'rename', account: a })}
                    onInclusion={(v) => void setInclusion(a, v)}
                    onOpen={() => onOpen?.(a.id)}
                    onPayBill={onPayBill ? () => onPayBill(a.id) : undefined}
                    onRenameSubmit={async (name) => {
                      const r = await api.rename(a.id, name);
                      if (r.ok) {
                        setMode({ kind: 'list' });
                        await refresh();
                      } else toast.show({ message: copy.accounts.renameFailed });
                      return r.ok;
                    }}
                    onRenameCancel={() => setMode({ kind: 'list' })}
                  />
                ))}
              </View>
            ),
          )}
          <NetWorthFooter on={netWorthOn.data === true} onToggle={(v) => void setNetWorth(v)} net={groups.netWorth} currency={profile.data?.currency} locale={profile.data?.locale} />
        </>
      ) : null}
      </ScrollView>
    </View>
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
  onInclusion: (include: boolean) => void;
  onOpen: () => void;
  onPayBill?: () => void;
  onRenameSubmit: (name: string) => Promise<boolean>;
  onRenameCancel: () => void;
}) {
  const { account: a, currency, locale, isFirst, isLast, editing } = props;
  const theme = useTheme();
  const [name, setName] = useState(a.name);
  const [error, setError] = useState(false);

  const line = accountLine(a);
  const counted = a.type === 'card' || a.includeInOverview !== false;
  const spoken = line.kind === 'not-set' || !currency ? copy.money.balanceNotSet : [lineWords(line), amountLabel({ amountMinor: line.minor, currency, locale })].filter(Boolean).join(' ');
  const label = `${a.name}, ${TYPE_LABEL[a.type]}, ${spoken}${counted ? '' : `, ${copy.accounts.notCounted}`}`;

  const actions = [
    ...(isFirst ? [] : [{ name: 'moveUp', label: copy.accounts.moveUp }]),
    ...(isLast ? [] : [{ name: 'moveDown', label: copy.accounts.moveDown }]),
    ...(a.type === 'card' && props.onPayBill ? [{ name: 'payBill', label: copy.accountDetail.payBill }] : []),
    { name: 'rename', label: copy.accounts.rename },
    { name: 'archive', label: copy.accounts.archive },
  ];

  return (
    <Pressable
      testID={`account-row-${a.id}`}
      accessible={!editing}
      accessibilityRole={editing ? undefined : 'button'}
      onPress={editing ? undefined : props.onOpen}
      accessibilityLabel={label}
      accessibilityActions={actions}
      onAccessibilityAction={(e) => {
        const n = e.nativeEvent.actionName;
        if (n === 'moveUp') props.onMove('up');
        else if (n === 'moveDown') props.onMove('down');
        else if (n === 'payBill') props.onPayBill?.();
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
          line.kind === 'not-set' || !currency ? (
            <Text testID={`balance-${a.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.money.balanceNotSet}</Text>
          ) : (
            <View testID={`balance-${a.id}`} style={styles.balance}>
              <View style={styles.inline}>
                {lineWords(line) ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{lineWords(line)}</Text> : null}
                <Amount amountMinor={line.minor} currency={currency} direction="neutral" locale={locale} />
              </View>
              {counted ? null : <Text testID={`not-counted-${a.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.notCounted}</Text>}
            </View>
          )
        ) : null}
      </View>

      <View style={styles.actions}>
        {editing ? (
          <>
            {a.type === 'card' ? null : (
              <View style={styles.switchRow}>
                <Text style={[textStyle('body'), { color: theme.color('text-primary'), flex: 1 }]}>{copy.accounts.countInTotals}</Text>
                <Switch
                  testID={`include-${a.id}`}
                  accessibilityLabel={copy.accounts.countInTotals}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: counted }}
                  value={counted}
                  onValueChange={props.onInclusion}
                  trackColor={{ false: theme.color('border-control'), true: theme.color('accent-primary') }}
                />
              </View>
            )}
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
            {a.type === 'card' && props.onPayBill ? <Button label={copy.accountDetail.payBill} variant="text" onPress={props.onPayBill} testID={`pay-bill-${a.id}`} /> : null}
            <Button label={copy.accounts.rename} variant="text" onPress={props.onRename} testID={`rename-${a.id}`} />
            <Button label={copy.accounts.archive} variant="text" onPress={props.onArchive} testID={`archive-${a.id}`} />
          </>
        )}
      </View>
    </Pressable>
  );
}

function lineWords(l: Exclude<AccountLineView, { kind: 'not-set' }>): string {
  return l.kind === 'owe' ? copy.accounts.youOwe : l.kind === 'below-zero' ? copy.accounts.belowZero : l.kind === 'in-credit' ? copy.accounts.inCredit : '';
}

function GroupHeader({ title, group, currency, locale, kind, testID }: { title: string; group: AccountGroup; currency?: CurrencyCode; locale?: string; kind: 'account' | 'card'; testID: string }) {
  const theme = useTheme();
  if (!currency) return null;
  const notSetYet = group.total.kind === 'not-set-yet';
  const note = notSetYet ? null : notSetNote(group.notSetCount, kind);
  const excl = group.excludedCount > 0 ? (group.excludedCount === 1 ? copy.accounts.excludes : copy.accounts.excludesMany).replace('{n}', String(group.excludedCount)) : null;
  const spoken = [title, group.total.kind === 'not-set-yet' ? copy.accounts.notSetYet : spokenTotal(group.total, currency, locale), note, excl].filter(Boolean).join(', ');
  const muted = { color: theme.color('text-secondary') };
  return (
    <View testID={testID} accessible accessibilityRole="header" accessibilityLabel={spoken} style={styles.groupHeader}>
      <Text style={[textStyle('title'), { color: theme.color('text-primary') }]}>{title}</Text>
      <View testID={`${testID}-total`} style={styles.inline}>
        {group.total.kind === 'not-set-yet' ? (
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.accounts.notSetYet}</Text>
        ) : (
          <>
            {group.total.kind === 'below-zero' ? <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.accounts.belowZero}</Text> : null}
            <Amount amountMinor={group.total.minor} currency={currency} direction="neutral" locale={locale} />
          </>
        )}
        {note ? <Text style={[textStyle('caption'), muted]}>{`· ${note}`}</Text> : null}
      </View>
      {excl ? <Text testID={`${testID}-excludes`} style={[textStyle('caption'), muted]}>{excl}</Text> : null}
    </View>
  );
}

function spokenTotal(t: Exclude<GroupTotalView, { kind: 'not-set-yet' }>, currency: CurrencyCode, locale?: string): string {
  const a = amountLabel({ amountMinor: t.minor, currency, locale });
  return t.kind === 'below-zero' ? `${copy.accounts.belowZero} ${a}` : a;
}

function NetWorthFooter({ on, onToggle, net, currency, locale }: { on: boolean; onToggle: (v: boolean) => void; net: ReturnType<typeof accountGroups>['netWorth']; currency?: CurrencyCode; locale?: string }) {
  const theme = useTheme();
  const ink = { color: theme.color('text-primary') };
  const [before, after] = copy.accounts.netWorthOweMore.split('{amount}');
  return (
    <View style={styles.group}>
      {on && net && currency ? (
        <View testID="net-worth" accessible style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <View style={styles.inline}>
            <Text style={[textStyle('body-medium'), ink]}>{net.kind === 'owe-more' ? before : copy.accounts.netWorth}</Text>
            <Amount amountMinor={net.minor} currency={currency} direction="neutral" locale={locale} />
            {net.kind === 'owe-more' ? <Text style={[textStyle('body-medium'), ink]}>{after}</Text> : null}
          </View>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.netWorthCaption}</Text>
        </View>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={[textStyle('body'), { color: theme.color('text-primary'), flex: 1 }]}>{copy.accounts.showNetWorth}</Text>
        <Switch
          testID="switch-net-worth"
          accessibilityLabel={copy.accounts.showNetWorth}
          accessibilityRole="switch"
          accessibilityState={{ checked: on }}
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: theme.color('border-control'), true: theme.color('accent-primary') }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupHeader: { gap: 2, paddingTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin, width: '100%' },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  balance: { alignItems: 'flex-end' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
