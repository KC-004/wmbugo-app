import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bank, CreditCard, Money, PiggyBank, Wallet } from 'phosphor-react-native';
import { ACCOUNT_TYPES, accountGroups, accountLine, validateAccountName, type AccountType, type AccountGroup, type AccountLineView, type AccountRow, type CurrencyCode, type GroupTotalView, type NewAccount, notSetNote } from '@wmbugo/core';
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
import { Chip } from '../../shared/ui/Chip';
import { ScreenHeader } from '../shell/ScreenHeader';
import { ArchivedSection } from './ArchivedSection';
import { AccountForm, TYPE_LABEL } from './AccountForm';
import { ACCOUNTS_QUERY_KEY, NET_WORTH_QUERY_KEY, PROFILE_QUERY_KEY, realAccountsApi, type AccountsApi } from './accountsApi';

const ICONS: Readonly<Record<string, IconComponent>> = { Money, Bank, Wallet, PiggyBank, CreditCard };

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'rename'; account: AccountRow };

/**
 * The accounts list: active accounts in Mei's order with a ledger-derived balance or "Balance not set"
 * (never zero), add, rename, Move up / Move down (also TalkBack custom actions) and delete for an account that never held anything. Archiving is on the account's own page, where it can warn first.
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
  const theme = useTheme();
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
  const archivedRows = (accounts.data ?? []).filter((a) => a.status === 'archived');

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
            g.rows.length === 0 && g.savedRows.length === 0 ? null : (
              <View key={key} testID={`group-${key}`} style={styles.group}>
                <GroupHeader testID={`group-${key}-header`} title={title} group={g} currency={profile.data?.currency} locale={profile.data?.locale} kind={key === 'owe' ? 'card' : 'account'} />
                {[...g.rows.map((a) => ({ a, saved: false })), ...g.savedRows.map((a) => ({ a, saved: true }))].map(({ a, saved }, i) => (
                  <View key={a.id} style={styles.group}>
                  {saved && i === g.rows.length ? (
                    <Text testID="saved-heading" accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.accounts.savedHeading}</Text>
                  ) : null}
                  <AccountRowView
                    account={a}
                    currency={profile.data?.currency}
                    locale={profile.data?.locale}
                    isFirst={saved || i === 0}
                    isLast={saved || i === g.rows.length - 1}
                    onChangeType={async (t) => {
                      const r = await api.changeType(a.id, t);
                      if (!r.ok) toast.show({ message: r.code === 'HAS_ENTRIES' ? copy.accounts.typeBlocked : copy.accounts.inclusionFailed });
                      await refresh();
                    }}
                    editing={mode.kind === 'rename' && mode.account.id === a.id}
                    onMove={(d) => void move(a, d)}
                    onDelete={async () => {
                      const r = await api.deleteAccount(a.id);
                      if (!r.ok) toast.show({ message: copy.archive.failed });
                      setMode({ kind: 'list' });
                      await refresh();
                    }}
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
                  </View>
                ))}
              </View>
            ),
          )}
          <NetWorthFooter on={netWorthOn.data === true} onToggle={(v) => void setNetWorth(v)} net={groups.netWorth} currency={profile.data?.currency} locale={profile.data?.locale} />
        </>
      ) : null}
      {archivedRows.length > 0 ? (
        <ArchivedSection
          rows={archivedRows}
          currency={profile.data?.currency}
          locale={profile.data?.locale}
          onOpen={(id) => onOpen?.(id)}
          onRestore={async (id) => {
            const r = await api.restore(id);
            if (!r.ok) toast.show({ message: copy.accounts.restoreFailed });
            await refresh();
          }}
        />
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
  onDelete: () => void;
  onRename: () => void;
  onInclusion: (include: boolean) => void;
  onOpen: () => void;
  onChangeType: (type: AccountType) => void;
  onPayBill?: () => void;
  onRenameSubmit: (name: string) => Promise<boolean>;
  onRenameCancel: () => void;
}) {
  const { account: a, currency, locale, isFirst, isLast, editing } = props;
  const theme = useTheme();
  const [name, setName] = useState(a.name);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const line = accountLine(a);
  const counted = a.type === 'card' || a.includeInOverview !== false;
  const movedIn = line.kind === 'moved-in';
  const spoken =
    line.kind === 'not-set' || !currency
      ? copy.money.balanceNotSet
      : movedIn
        ? line.minor === 0
          ? copy.accounts.nothingMovedIn
          : `${amountLabel({ amountMinor: line.minor, currency, locale })} ${copy.accounts.movedIn.toLowerCase()}`
        : [lineWords(line), amountLabel({ amountMinor: line.minor, currency, locale })].filter(Boolean).join(' ');
  const label = `${a.name}, ${TYPE_LABEL[a.type]}, ${spoken}${counted ? '' : `, ${copy.accounts.notCounted}`}${movedIn ? `, ${copy.accounts.notInYourTotals.toLowerCase()}` : ''}`;

  const actions = [
    ...(isFirst ? [] : [{ name: 'moveUp', label: copy.accounts.moveUp }]),
    ...(isLast ? [] : [{ name: 'moveDown', label: copy.accounts.moveDown }]),
    ...(a.type === 'card' && props.onPayBill ? [{ name: 'payBill', label: copy.accountDetail.payBill }] : []),
    { name: 'rename', label: copy.accounts.rename },
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
                {line.kind === 'moved-in' && line.minor === 0 ? (
                  <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.nothingMovedIn}</Text>
                ) : (
                  <Amount amountMinor={line.minor} currency={currency} direction="neutral" locale={locale} />
                )}
                {line.kind === 'moved-in' && line.minor > 0 ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.movedIn.toLowerCase()}</Text> : null}
              </View>
              {counted ? null : <Text testID={`not-counted-${a.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.notCounted}</Text>}
            </View>
          )
        ) : null}
      </View>

      <View style={styles.actions}>
        {editing ? (
          <>
            <View accessibilityRole="radiogroup" accessibilityLabel={copy.accounts.typeLabel} style={styles.typeChips}>
              {ACCOUNT_TYPES.map((t) => (
                <Chip key={t} label={TYPE_LABEL[t]} variant="account" testID={`type-${a.id}-${t}`} selected={a.type === t} onPress={() => (a.type === t ? undefined : props.onChangeType(t))} />
              ))}
            </View>
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
            {a.postingCount === 0 ? (
              confirming ? (
                <View testID="delete-confirm" style={styles.group}>
                  <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.archive.deleteConfirm.replace('{name}', a.name)}</Text>
                  <View style={styles.typeChips}>
                    <Button label={copy.archive.deleteYes} onPress={props.onDelete} testID={`delete-yes-${a.id}`} />
                    <Button label={copy.common.cancel} variant="text" onPress={() => setConfirming(false)} testID={`delete-no-${a.id}`} />
                  </View>
                </View>
              ) : (
                <Button label={copy.archive.deleteAccount} variant="text" onPress={() => setConfirming(true)} testID={`delete-${a.id}`} />
              )
            ) : (
              <Text testID={`delete-hint-${a.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.archive.deleteHint}</Text>
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
  typeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
