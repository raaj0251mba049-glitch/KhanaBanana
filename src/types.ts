export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export type PreferredLanguage = 'Hinglish' | 'English' | 'Hindi';
export type DietaryPreference = 'Vegetarian' | 'Non-Vegetarian' | 'Eggetarian' | 'Vegan';
export type SpiceTolerance = 'Mild' | 'Medium' | 'Spicy' | 'Extra Spicy';
export type CookingEquipment = 'Gas Stove' | 'Induction' | 'Both';
export type UtensilPreference = 'One Pan / Kadhai' | 'Multiple Utensils' | 'Pressure Cooker + Pan';
export type PrepTimePreference = 'Under 15 mins' | '15-30 mins' | '30-45 mins' | 'No limit';
export type HumourLevel = 'Mild' | 'Friendly teasing' | 'Full-on desi dost';
export type ConversationStyle = 'Short & Punchy' | 'Warm & Detailed' | 'Pure Desi Banter';

export type ConversationState =
  | 'IDLE'
  | 'INVENTORY_UPDATE'
  | 'FOOD_DISCOVERY'
  | 'DISH_DISCOVERY'
  | 'RECIPE_SELECTED'
  | 'RECIPE_GENERATION'
  | 'COOKING_MODE';

export type ChatResponseMode =
  | 'INVENTORY_UPDATE'
  | 'FOOD_DISCOVERY'
  | 'DISH_DISCOVERY'
  | 'RECIPE_SELECTED'
  | 'GENERAL_CHAT';

export interface DiscoveryContext {
  mood?: string;
  craving?: string;
  recentMealNote?: string;
  timeAvailable?: string;
  shoppingPreference?: string;
  activeBudget?: number | null;
  lastSuggestedDishes?: SuggestedDish[];
  rejectedDishes?: string[];
  selectedDishName?: string;
  turnsInDiscovery?: number;
}

export type InventoryCategory =
  | 'Vegetables'
  | 'Fruits'
  | 'Grains'
  | 'Rice'
  | 'Pulses'
  | 'Dairy'
  | 'Eggs and meat'
  | 'Spices'
  | 'Sauces'
  | 'Other';

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  'Vegetables',
  'Fruits',
  'Grains',
  'Rice',
  'Pulses',
  'Dairy',
  'Eggs and meat',
  'Spices',
  'Sauces',
  'Other',
];

export const FIELD_LIMITS = {
  DISPLAY_NAME_MAX: 80,
  BUDDY_NAME_MAX: 40,
  ITEM_NAME_MAX: 80,
  ITEM_QTY_MAX: 50,
  MESSAGE_MAX: 20000,
  RECENT_MEALS_MAX: 20,
  MEMORY_NOTES_MAX: 30,
  CUISINES_MAX: 10,
  ALLERGIES_MAX: 20,
  DISLIKED_MAX: 30,
};

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  buddyName: string;
  humourLevel?: HumourLevel;
  conversationStyle?: ConversationStyle;
  preferredLanguage: PreferredLanguage;
  dietaryPreference: DietaryPreference;
  spiceTolerance: SpiceTolerance;
  favouriteCuisines: string[];
  allergies: string[];
  dislikedIngredients: string[];
  defaultEquipment: CookingEquipment;
  defaultUtensils: UtensilPreference;
  defaultServings: number;
  preferredPrepTime: PrepTimePreference;
  defaultBudget: number | null;
  hasExplicitDefaultBudget?: boolean;
  recentMeals: string[];
  memoryNotes?: string[];
  conversationState?: ConversationState;
  discoveryContext?: DiscoveryContext;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DetectedPreferenceUpdates {
  spiceTolerance?: SpiceTolerance;
  dietaryPreference?: DietaryPreference;
  addFavouriteCuisines?: string[];
  addAllergies?: string[];
  addDislikedIngredients?: string[];
  addMemoryNotes?: string[];
}

export interface InventoryItem {
  id: string;
  userId: string;
  canonicalName?: string;
  displayName?: string;
  name: string;
  numericQuantity?: number;
  unit?: string;
  quantity: string;
  category: InventoryCategory;
  isRegular: boolean;
  isAvailable: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type InventoryTransactionAction =
  | 'PURCHASE'
  | 'CONSUMPTION'
  | 'MANUAL_ADD'
  | 'MANUAL_REMOVE'
  | 'QUANTITY_CORRECTION'
  | 'MARK_UNAVAILABLE'
  | 'RESTOCK';

export type InventoryTransactionSource =
  | 'chat'
  | 'cooking_mode'
  | 'manual_ui'
  | 'shopping_transfer';

export interface InventoryTransaction {
  id: string;
  userId: string;
  itemId: string;
  ingredientName: string;
  canonicalName: string;
  actionType: InventoryTransactionAction;
  deltaQuantity: number;
  unit: string;
  previousQuantity: number;
  newQuantity: number;
  source: InventoryTransactionSource;
  note: string;
  createdAt?: unknown;
}

export type DetectedActionKind =
  | 'ADD_INGREDIENT'
  | 'UPDATE_QUANTITY'
  | 'REMOVE_INGREDIENT'
  | 'MARK_UNAVAILABLE'
  | 'CONSUME_INGREDIENT'
  | 'RESTOCK_INGREDIENT'
  | 'QUERY_INVENTORY'
  | 'NO_INVENTORY_ACTION';

export interface DetectedInventoryAction {
  action: DetectedActionKind;
  ingredient: string;
  canonicalName?: string;
  quantity?: number | null;
  unit?: string | null;
  category?: InventoryCategory;
  confidence: number;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  isPurchase?: boolean;
}

export interface AppliedInventoryResult {
  action: DetectedActionKind;
  ingredient: string;
  canonicalName: string;
  displayName: string;
  previousQtyText?: string;
  newQtyText?: string;
  status: 'applied' | 'needs_clarification' | 'failed' | 'skipped';
  message: string;
}

export interface ShoppingListItem {
  name: string;
  quantity: string;
  estimatedPriceRange: string;
  estimatedCostInr: number;
  isEssential: boolean;
  reuseNote?: string;
}

export interface ShoppingSummary {
  budgetLimit: number;
  isWithinBudget: boolean;
  availableUsed: string[];
  itemsToBuy: ShoppingListItem[];
  totalEstimatedCost: number;
  remainingBudget: number;
  disclaimer: string;
}

export interface SuggestedDish {
  dishName: string;
  cuisine: string;
  shortPitch: string;
  prepCookTime: string;
  servings?: number;
  estimatedExtraCostInr: number;
  usesExistingOnly?: boolean;
  matchReason: string;
  imageCategory: 'north_indian' | 'street_food' | 'indo_chinese' | 'kitchen';
  requiredIngredients?: RecipeIngredient[];
  availableIngredients?: string[];
  missingIngredients?: RecipePurchaseItem[];
  ingredientConsumptionValueInr?: number;
  missingIngredientValueInr?: number;
  actualShoppingOutlayInr?: number;
  fitsActiveBudget?: boolean;
  substitutionsNote?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  buddyNameSnapshot: string;
  budgetLimit?: number;
  shoppingSummary?: ShoppingSummary;
  suggestedDishes?: SuggestedDish[];
  inventoryResults?: AppliedInventoryResult[];
  attachedRecipeId?: string;
  responseMode?: ChatResponseMode;
  selectedDishName?: string;
  createdAt?: unknown;
}

export interface RecipeIngredient {
  name: string;
  canonicalName?: string;
  quantity: string;
  numericQuantity?: number;
  unit?: string;
  isEssential?: boolean;
  notes?: string;
}

export interface RecipePurchaseItem {
  name: string;
  canonicalName?: string;
  quantity: string;
  neededQuantity?: string;
  purchasePackQuantity?: string;
  estimatedPriceRange: string;
  estimatedCostInr?: number;
  portionCostInr?: number;
  isEssential: boolean;
}

export interface RecipeStep {
  stepNumber: number;
  title: string;
  instruction: string;
  heatLevel: string;
  duration: string;
  tip?: string;
}

export interface SavedRecipe {
  id: string;
  userId: string;
  dishName: string;
  cuisine: string;
  description: string;
  servings: number;
  prepTime: string;
  cookTime: string;
  difficulty: 'Easy' | 'Medium' | 'Challenging';
  spiceLevel: SpiceTolerance;
  exactIngredients: RecipeIngredient[];
  existingIngredients: string[];
  ingredientsToPurchase: RecipePurchaseItem[];
  estimatedPurchaseCost: string;
  ingredientConsumptionValueInr?: number;
  missingIngredientValueInr?: number;
  actualShoppingOutlayInr?: number;
  appliedBudgetLimit?: number | null;
  requiredUtensils: string[];
  applianceType: 'Gas' | 'Induction' | 'Both';
  applianceGuidance: string;
  steps: RecipeStep[];
  tasteEnhancers: string[];
  substitutions: string[];
  commonMistakes: string[];
  storageGuidance: string;
  isSaved: boolean;
  imageCategory: 'north_indian' | 'street_food' | 'indo_chinese' | 'kitchen';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AppView = 'chat' | 'kitchen' | 'recipes' | 'preferences';
