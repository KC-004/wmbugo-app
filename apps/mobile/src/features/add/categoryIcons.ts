import {
  Airplane, AirplaneTilt, ArrowUUpLeft, Backpack, Baby, Bank, Barbell, Basket, Bed, BeerStein, Bicycle, Books, Briefcase, Bus, Buildings, Camera, Car, ChartLineUp, Coffee, Coins,
  Couch, CreditCard, Drop, DeviceMobile, DotsThree, FilmSlate, FirstAid, Flower, ForkKnife, GameController, GasPump, Gift, GraduationCap, HandHeart, Hamburger, Hammer, Heart,
  Heartbeat, House, Laptop, Lightning, MusicNotes, PawPrint, Percent, Pill, PiggyBank, Pizza, Plant, Question, Receipt, Scissors, ShoppingBag, ShoppingCart, Taxi, Television, Ticket,
  Tooth, Train, Tree, TShirt, Umbrella, UsersThree, Wallet, WifiHigh, Wrench,
} from 'phosphor-react-native';
import type { IconComponent } from '../../shared/theme/Icon';

/** Phosphor glyph per category icon name: the seeds first, then the grid in the category sheet. */
const ICONS: Readonly<Record<string, IconComponent>> = {
  Airplane, AirplaneTilt, ArrowUUpLeft, Backpack, Baby, Bank, Barbell, Basket, Bed, BeerStein, Bicycle, Books, Briefcase, Bus, Buildings, Camera, Car, ChartLineUp, Coffee, Coins,
  Couch, CreditCard, Drop, DeviceMobile, DotsThree, FilmSlate, FirstAid, Flower, ForkKnife, GameController, GasPump, Gift, GraduationCap, HandHeart, Hamburger, Hammer, Heart,
  Heartbeat, House, Laptop, Lightning, MusicNotes, PawPrint, Percent, Pill, PiggyBank, Pizza, Plant, Question, Receipt, Scissors, ShoppingBag, ShoppingCart, Taxi, Television, Ticket,
  Tooth, Train, Tree, TShirt, Umbrella, UsersThree, Wallet, WifiHigh, Wrench,
};

export const categoryIcon = (name: string): IconComponent => ICONS[name] ?? DotsThree;

/** What the icon grid offers: the glyph name and the words a person might type to find it. */
export const ICON_CATALOGUE: readonly { readonly name: string; readonly words: string }[] = [
  { name: 'GasPump', words: 'fuel petrol gas diesel' },
  { name: 'Car', words: 'car vehicle auto' },
  { name: 'Taxi', words: 'taxi cab ride' },
  { name: 'Bus', words: 'bus transport commute' },
  { name: 'Train', words: 'train metro rail' },
  { name: 'Bicycle', words: 'bicycle bike cycle' },
  { name: 'Airplane', words: 'plane flight travel' },
  { name: 'AirplaneTilt', words: 'flight trip holiday' },
  { name: 'ForkKnife', words: 'food eat restaurant dining' },
  { name: 'Hamburger', words: 'burger fast food' },
  { name: 'Pizza', words: 'pizza takeaway' },
  { name: 'Coffee', words: 'coffee tea cafe' },
  { name: 'BeerStein', words: 'beer drinks bar' },
  { name: 'ShoppingCart', words: 'groceries cart supermarket' },
  { name: 'Basket', words: 'basket market vegetables' },
  { name: 'ShoppingBag', words: 'shopping bag clothes' },
  { name: 'TShirt', words: 'clothes shirt fashion' },
  { name: 'Scissors', words: 'haircut salon grooming' },
  { name: 'House', words: 'home rent housing' },
  { name: 'Couch', words: 'furniture sofa' },
  { name: 'Bed', words: 'bed stay hotel' },
  { name: 'Wrench', words: 'repair service maintenance' },
  { name: 'Hammer', words: 'tools build diy' },
  { name: 'Lightning', words: 'electricity power bill' },
  { name: 'Drop', words: 'water bill' },
  { name: 'WifiHigh', words: 'internet wifi broadband' },
  { name: 'DeviceMobile', words: 'phone mobile recharge' },
  { name: 'Receipt', words: 'bills receipt utilities' },
  { name: 'Television', words: 'tv streaming subscription' },
  { name: 'FilmSlate', words: 'movies cinema entertainment' },
  { name: 'GameController', words: 'games gaming' },
  { name: 'MusicNotes', words: 'music concert' },
  { name: 'Ticket', words: 'tickets events' },
  { name: 'Camera', words: 'photo camera hobby' },
  { name: 'Barbell', words: 'gym fitness sport' },
  { name: 'Heartbeat', words: 'health doctor' },
  { name: 'FirstAid', words: 'medical first aid clinic' },
  { name: 'Pill', words: 'medicine pharmacy' },
  { name: 'Tooth', words: 'dentist dental' },
  { name: 'PawPrint', words: 'pet dog cat vet' },
  { name: 'Baby', words: 'baby kids child' },
  { name: 'UsersThree', words: 'family people' },
  { name: 'GraduationCap', words: 'education school college' },
  { name: 'Books', words: 'books study course' },
  { name: 'Backpack', words: 'school bag' },
  { name: 'Gift', words: 'gift present' },
  { name: 'HandHeart', words: 'charity donation help' },
  { name: 'Heart', words: 'love favourite' },
  { name: 'Flower', words: 'flowers personal care' },
  { name: 'Plant', words: 'garden plants' },
  { name: 'Tree', words: 'nature outdoors' },
  { name: 'Umbrella', words: 'insurance cover rain' },
  { name: 'PiggyBank', words: 'savings piggy' },
  { name: 'Wallet', words: 'wallet cash pocket' },
  { name: 'CreditCard', words: 'card credit fees' },
  { name: 'Bank', words: 'bank loan emi' },
  { name: 'Coins', words: 'coins change interest' },
  { name: 'ChartLineUp', words: 'investment stocks returns' },
  { name: 'Percent', words: 'interest tax percent' },
  { name: 'Briefcase', words: 'work salary job' },
  { name: 'Laptop', words: 'laptop freelance computer' },
  { name: 'Buildings', words: 'office business city' },
  { name: 'DotsThree', words: 'other misc more' },
];

/** The icons whose name or words contain every word typed. An empty search lists them all. */
export function searchIcons(query: string): typeof ICON_CATALOGUE {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ICON_CATALOGUE;
  return ICON_CATALOGUE.filter((i) => words.every((w) => `${i.name} ${i.words}`.toLowerCase().includes(w)));
}
