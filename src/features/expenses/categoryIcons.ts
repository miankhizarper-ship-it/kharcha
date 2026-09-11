import type {ComponentProps} from 'react';
import type {Ionicons} from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Maps the stable icon keys stored in the `categories.icon` column (seeded by
 * migration 001, extended by the category management feature) to Ionicons
 * glyphs. The database never stores UI values — this map is the single place
 * where keys become glyphs.
 *
 * When adding keys here, also add a labeled entry to
 * `features/categories/icons.ts` so the picker can offer it. Every key must
 * exist in the Ionicons glyph map (verified against
 * react-native-vector-icons/glyphmaps/Ionicons.json).
 */
const CATEGORY_ICON_MAP: Record<string, IoniconName> = {
  restaurant: 'restaurant',
  cart: 'cart',
  bus: 'bus',
  home: 'home',
  flash: 'flash',
  medkit: 'medkit',
  school: 'school',
  bag: 'bag',
  film: 'film',
  pricetag: 'pricetag',
  briefcase: 'briefcase',
  storefront: 'storefront',
  laptop: 'laptop',
  'trending-up': 'trending-up',
  gift: 'gift',
  cash: 'cash',
  // Category management picker additions (verified glyph names).
  cafe: 'cafe',
  car: 'car',
  'car-sport': 'car-sport',
  airplane: 'airplane',
  boat: 'boat',
  subway: 'subway',
  bicycle: 'bicycle',
  'phone-portrait': 'phone-portrait',
  wifi: 'wifi',
  water: 'water',
  shield: 'shield',
  heart: 'heart',
  pulse: 'pulse',
  barbell: 'barbell',
  fitness: 'fitness',
  basketball: 'basketball',
  'game-controller': 'game-controller',
  'musical-notes': 'musical-notes',
  camera: 'camera',
  headset: 'headset',
  book: 'book',
  language: 'language',
  pizza: 'pizza',
  'fast-food': 'fast-food',
  'ice-cream': 'ice-cream',
  nutrition: 'nutrition',
  leaf: 'leaf',
  shirt: 'shirt',
  diamond: 'diamond',
  trophy: 'trophy',
  star: 'star',
  'color-palette': 'color-palette',
};

const FALLBACK_ICON: IoniconName = 'pricetag';

/** Resolves a stored category icon key to an Ionicons glyph name. */
export function categoryIconName(iconKey: string): IoniconName {
  return CATEGORY_ICON_MAP[iconKey] ?? FALLBACK_ICON;
}
