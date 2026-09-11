import {categoryIconName} from '@/features/expenses/categoryIcons';

/**
 * Labeled, ordered icon choices for the category form's picker. Keys must be
 * present in `CATEGORY_ICON_MAP` (features/expenses/categoryIcons.ts) — that
 * map stays the single key → glyph source of truth; this list only adds
 * human-readable labels and the display order.
 */
export interface CategoryIconChoice {
  key: string;
  label: string;
}

export const CATEGORY_ICON_CHOICES: readonly CategoryIconChoice[] = [
  // Original seeded set.
  {key: 'restaurant', label: 'Food & Dining'},
  {key: 'cart', label: 'Groceries'},
  {key: 'bus', label: 'Transport'},
  {key: 'home', label: 'Housing'},
  {key: 'flash', label: 'Utilities'},
  {key: 'medkit', label: 'Health'},
  {key: 'school', label: 'Education'},
  {key: 'bag', label: 'Shopping'},
  {key: 'film', label: 'Entertainment'},
  {key: 'pricetag', label: 'General'},
  {key: 'briefcase', label: 'Work'},
  {key: 'storefront', label: 'Business'},
  {key: 'laptop', label: 'Freelance'},
  {key: 'trending-up', label: 'Investment'},
  {key: 'gift', label: 'Gift'},
  {key: 'cash', label: 'Money'},
  // Extended set for user-defined categories.
  {key: 'cafe', label: 'Cafe'},
  {key: 'pizza', label: 'Pizza'},
  {key: 'fast-food', label: 'Fast Food'},
  {key: 'ice-cream', label: 'Dessert'},
  {key: 'nutrition', label: 'Diet'},
  {key: 'car', label: 'Car'},
  {key: 'car-sport', label: 'Sports Car'},
  {key: 'airplane', label: 'Travel'},
  {key: 'boat', label: 'Boat'},
  {key: 'subway', label: 'Metro'},
  {key: 'bicycle', label: 'Cycling'},
  {key: 'phone-portrait', label: 'Phone'},
  {key: 'wifi', label: 'Internet'},
  {key: 'water', label: 'Water'},
  {key: 'shield', label: 'Insurance'},
  {key: 'heart', label: 'Charity'},
  {key: 'pulse', label: 'Fitness'},
  {key: 'barbell', label: 'Gym'},
  {key: 'basketball', label: 'Sports'},
  {key: 'game-controller', label: 'Games'},
  {key: 'musical-notes', label: 'Music'},
  {key: 'camera', label: 'Photography'},
  {key: 'headset', label: 'Audio'},
  {key: 'book', label: 'Books'},
  {key: 'language', label: 'Learning'},
  {key: 'leaf', label: 'Nature'},
  {key: 'shirt', label: 'Clothing'},
  {key: 'diamond', label: 'Luxury'},
  {key: 'trophy', label: 'Awards'},
  {key: 'star', label: 'Favorite'},
  {key: 'color-palette', label: 'Hobby'},
];

/**
 * True when the icon key can be rendered by the app's icon map. Used by the
 * picker and by tests so an unknown stored key can never reach the form.
 */
export function isKnownCategoryIcon(key: string): boolean {
  return CATEGORY_ICON_CHOICES.some(choice => choice.key === key);
}

/** Rendering helper shared by rows and the picker grid. */
export {categoryIconName};
