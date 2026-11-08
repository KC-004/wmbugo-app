import { Airplane, ArrowUUpLeft, Briefcase, Bus, DotsThree, FilmSlate, Flower, ForkKnife, Gift, GraduationCap, HandHeart, Heartbeat, House, Laptop, Percent, Question, Receipt, ShoppingBag, ShoppingCart, UsersThree } from 'phosphor-react-native';
import type { IconComponent } from '../../shared/theme/Icon';

/** Phosphor glyph per seeded category icon name. */
const ICONS: Readonly<Record<string, IconComponent>> = {
  Airplane, ArrowUUpLeft, Briefcase, Bus, DotsThree, FilmSlate, Flower, ForkKnife, Gift, GraduationCap, HandHeart,
  Heartbeat, House, Laptop, Percent, Question, Receipt, ShoppingBag, ShoppingCart, UsersThree,
};

export const categoryIcon = (name: string): IconComponent => ICONS[name] ?? DotsThree;
