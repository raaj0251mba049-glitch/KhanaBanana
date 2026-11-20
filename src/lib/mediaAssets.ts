export const MEDIA_ASSETS = {
  heroKitchen: '/src/assets/images/hero_indian_kitchen_1795117749937.jpg',
  buddyAvatar: '/src/assets/images/avatar_khanabanana_1795117748930.jpg',
  dishes: {
    north_indian: '/src/assets/images/dish_north_indian_1795117749262.jpg',
    street_food: '/src/assets/images/dish_street_food_1795117749505.jpg',
    indo_chinese: '/src/assets/images/dish_indo_chinese_1795117749520.jpg',
    kitchen: '/src/assets/images/hero_indian_kitchen_1795117749937.jpg',
  },
} as const;

export function getDishImage(category?: string): string {
  if (category === 'north_indian') return MEDIA_ASSETS.dishes.north_indian;
  if (category === 'street_food') return MEDIA_ASSETS.dishes.street_food;
  if (category === 'indo_chinese') return MEDIA_ASSETS.dishes.indo_chinese;
  return MEDIA_ASSETS.dishes.kitchen;
}
