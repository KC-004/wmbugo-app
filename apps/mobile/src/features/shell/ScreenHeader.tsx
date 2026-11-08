import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { UserCircle, Wallet } from 'phosphor-react-native';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { headerSplits } from '../../shared/feedback/layout';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { FocusRing, useFocusRing } from '../../shared/ui/FocusRing';
import { textStyle } from '../../shared/theme/typography';

/**
 * Screen header: screen actions first, then the Accounts icon and the avatar (which opens
 * Settings). At font scale 1.3 and above it becomes two rows and the title wraps; it is never truncated.
 */
export function ScreenHeader({
  title,
  actions,
  onAccounts,
  onProfile,
}: {
  title: string;
  actions?: ReactNode;
  onAccounts: () => void;
  onProfile: () => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const split = headerSplits(fontScale);
  const titleNode = (
    <Text accessibilityRole="header" style={[textStyle('title'), styles.title, { color: theme.color('text-primary') }]}>
      {title}
    </Text>
  );
  const actionRow = (
    <View style={styles.actions}>
      {actions}
      <IconButton label={copy.nav.accounts} onPress={onAccounts} testID="header-accounts">
        <Icon icon={Wallet} />
      </IconButton>
      <IconButton label={copy.nav.profile} onPress={onProfile} testID="header-avatar">
        <Icon icon={UserCircle} />
      </IconButton>
    </View>
  );
  return split ? (
    <View testID="header" style={styles.column}>
      {titleNode}
      {actionRow}
    </View>
  ) : (
    <View testID="header" style={styles.row}>
      {titleNode}
      {actionRow}
    </View>
  );
}

export function IconButton({ label, onPress, children, testID }: { label: string; onPress: () => void; children: ReactNode; testID?: string }) {
  const { focused, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable testID={testID} {...controlA11y({ label, role: 'button' })} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={styles.icon}>
      <FocusRing focused={focused} radius={radii.full}>
        {children}
      </FocusRing>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  column: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  icon: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
});
