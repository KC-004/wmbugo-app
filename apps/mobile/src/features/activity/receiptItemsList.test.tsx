import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReceiptItemView } from '@wmbugo/core';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ReceiptItemsList } from './ReceiptItemsList';

const items: ReceiptItemView[] = [
  { name: 'Rice 5kg', amountMinor: 4200, discountMinor: 100, allocatedMinor: 3780, categoryId: 'cat_groceries', categoryName: 'Groceries', lineIndex: 0 },
  { name: 'Dish soap', amountMinor: 1800, discountMinor: 0, allocatedMinor: 1620, categoryId: 'cat_shopping', categoryName: 'Shopping', lineIndex: 1 },
];
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0];

describe('ReceiptItemsList (Story 10.5)', () => {
  it('shows Items (N) collapsed, announces expanded, then one read-only row per item with its category and discount', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider initialMode="light">
          <ReceiptItemsList items={items} currency="SGD" locale="en-SG" />
        </ThemeProvider>,
      );
    });
    expect(host(r, 'detail-item-0')).toBeUndefined();
    expect(host(r, 'detail-items-toggle')!.props.accessibilityLabel).toContain('Items (2)');
    expect(host(r, 'detail-items-toggle')!.props.accessibilityState).toMatchObject({ expanded: false });
    act(() => r.root.findAll((n) => n.props.testID === 'detail-items-toggle' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(host(r, 'detail-items-toggle')!.props.accessibilityState).toMatchObject({ expanded: true });
    expect(host(r, 'detail-item-0')!.props.accessibilityLabel).toContain('Rice 5kg');
    expect(host(r, 'detail-item-0')!.props.accessibilityLabel).toContain('Groceries');
    expect(host(r, 'detail-item-1')).toBeDefined();
    act(() => r.unmount());
  });
});
