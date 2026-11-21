import {
  cleanRawIngredientName,
  formatQuantity,
  normalizeIngredientMeta,
  normalizeUnit,
  parseQuantityString,
  toBaseQuantity,
} from './inventoryUtils.ts';
import type {
  InventoryItem,
  RecipeIngredient,
  RecipePurchaseItem,
} from '../types';

export interface IngredientCatalogEntry {
  canonicalName: string;
  /** Approximate price in INR per base unit ('g', 'ml', 'pieces', 'packets', 'bunch') */
  pricePerBaseUnit: number;
  baseUnit: 'g' | 'ml' | 'pieces' | 'packets' | 'bunch';
  /** Practical minimum retail pack size bought at a local Indian kirana/sabzi shop */
  minPackQty: number;
  minPackLabel: string;
  minPackPriceInr: number;
  /** Approximate grams per single piece for cross-unit matching (e.g. 1 onion ~= 80g) */
  gramsPerPiece?: number;
  defaultEssential?: boolean;
}

const INGREDIENT_CATALOG: Record<string, IngredientCatalogEntry> = {
  potato: {
    canonicalName: 'potato',
    pricePerBaseUnit: 0.035, // ₹35/kg
    baseUnit: 'g',
    minPackQty: 250,
    minPackLabel: '250g',
    minPackPriceInr: 10,
    gramsPerPiece: 100,
    defaultEssential: true,
  },
  onion: {
    canonicalName: 'onion',
    pricePerBaseUnit: 0.045, // ₹45/kg
    baseUnit: 'g',
    minPackQty: 250,
    minPackLabel: '250g',
    minPackPriceInr: 12,
    gramsPerPiece: 80,
    defaultEssential: true,
  },
  tomato: {
    canonicalName: 'tomato',
    pricePerBaseUnit: 0.05, // ₹50/kg
    baseUnit: 'g',
    minPackQty: 250,
    minPackLabel: '250g',
    minPackPriceInr: 15,
    gramsPerPiece: 80,
    defaultEssential: true,
  },
  'green chilli': {
    canonicalName: 'green chilli',
    pricePerBaseUnit: 1.5, // ~₹1.5/piece or ₹10 small bunch
    baseUnit: 'pieces',
    minPackQty: 6,
    minPackLabel: 'small pack (50g)',
    minPackPriceInr: 10,
    gramsPerPiece: 5,
    defaultEssential: false,
  },
  coriander: {
    canonicalName: 'coriander',
    pricePerBaseUnit: 10,
    baseUnit: 'bunch',
    minPackQty: 1,
    minPackLabel: '1 bunch',
    minPackPriceInr: 10,
    gramsPerPiece: 30,
    defaultEssential: false,
  },
  ginger: {
    canonicalName: 'ginger',
    pricePerBaseUnit: 0.16, // ₹160/kg
    baseUnit: 'g',
    minPackQty: 50,
    minPackLabel: '50g',
    minPackPriceInr: 10,
    gramsPerPiece: 20,
    defaultEssential: false,
  },
  garlic: {
    canonicalName: 'garlic',
    pricePerBaseUnit: 0.2, // ₹200/kg
    baseUnit: 'g',
    minPackQty: 50,
    minPackLabel: '50g',
    minPackPriceInr: 10,
    gramsPerPiece: 5,
    defaultEssential: false,
  },
  capsicum: {
    canonicalName: 'capsicum',
    pricePerBaseUnit: 0.08,
    baseUnit: 'g',
    minPackQty: 150,
    minPackLabel: '1 piece (~150g)',
    minPackPriceInr: 12,
    gramsPerPiece: 120,
    defaultEssential: false,
  },
  peas: {
    canonicalName: 'peas',
    pricePerBaseUnit: 0.1,
    baseUnit: 'g',
    minPackQty: 200,
    minPackLabel: '200g',
    minPackPriceInr: 20,
    defaultEssential: false,
  },
  rice: {
    canonicalName: 'rice',
    pricePerBaseUnit: 0.07, // ₹70/kg
    baseUnit: 'g',
    minPackQty: 500,
    minPackLabel: '500g pack',
    minPackPriceInr: 35,
    defaultEssential: true,
  },
  'wheat flour': {
    canonicalName: 'wheat flour',
    pricePerBaseUnit: 0.045,
    baseUnit: 'g',
    minPackQty: 500,
    minPackLabel: '500g pack',
    minPackPriceInr: 25,
    defaultEssential: true,
  },
  dal: {
    canonicalName: 'dal',
    pricePerBaseUnit: 0.14,
    baseUnit: 'g',
    minPackQty: 250,
    minPackLabel: '250g pack',
    minPackPriceInr: 35,
    defaultEssential: true,
  },
  paneer: {
    canonicalName: 'paneer',
    pricePerBaseUnit: 0.42, // ₹85 per 200g
    baseUnit: 'g',
    minPackQty: 200,
    minPackLabel: '200g pack',
    minPackPriceInr: 85,
    defaultEssential: true,
  },
  curd: {
    canonicalName: 'curd',
    pricePerBaseUnit: 0.1,
    baseUnit: 'g',
    minPackQty: 200,
    minPackLabel: '200g cup',
    minPackPriceInr: 20,
    defaultEssential: false,
  },
  milk: {
    canonicalName: 'milk',
    pricePerBaseUnit: 0.06,
    baseUnit: 'ml',
    minPackQty: 500,
    minPackLabel: '500ml pouch',
    minPackPriceInr: 30,
    defaultEssential: true,
  },
  butter: {
    canonicalName: 'butter',
    pricePerBaseUnit: 0.56,
    baseUnit: 'g',
    minPackQty: 100,
    minPackLabel: '100g pack',
    minPackPriceInr: 56,
    defaultEssential: false,
  },
  cheese: {
    canonicalName: 'cheese',
    pricePerBaseUnit: 0.65,
    baseUnit: 'g',
    minPackQty: 100,
    minPackLabel: '100g pack',
    minPackPriceInr: 65,
    defaultEssential: false,
  },
  ghee: {
    canonicalName: 'ghee',
    pricePerBaseUnit: 0.6,
    baseUnit: 'ml',
    minPackQty: 100,
    minPackLabel: '100ml pouch',
    minPackPriceInr: 60,
    defaultEssential: false,
  },
  bread: {
    canonicalName: 'bread',
    pricePerBaseUnit: 3.5,
    baseUnit: 'pieces',
    minPackQty: 10,
    minPackLabel: '1 loaf',
    minPackPriceInr: 35,
    gramsPerPiece: 30,
    defaultEssential: true,
  },
  egg: {
    canonicalName: 'egg',
    pricePerBaseUnit: 7,
    baseUnit: 'pieces',
    minPackQty: 2,
    minPackLabel: '2 eggs',
    minPackPriceInr: 14,
    gramsPerPiece: 55,
    defaultEssential: true,
  },
  chicken: {
    canonicalName: 'chicken',
    pricePerBaseUnit: 0.28,
    baseUnit: 'g',
    minPackQty: 250,
    minPackLabel: '250g',
    minPackPriceInr: 70,
    defaultEssential: true,
  },
  maggi: {
    canonicalName: 'maggi',
    pricePerBaseUnit: 14,
    baseUnit: 'packets',
    minPackQty: 1,
    minPackLabel: '1 packet',
    minPackPriceInr: 14,
    defaultEssential: true,
  },
  'cooking oil': {
    canonicalName: 'cooking oil',
    pricePerBaseUnit: 0.16, // ~₹160/L (~₹2.5 per 15ml)
    baseUnit: 'ml',
    minPackQty: 100,
    minPackLabel: '100ml pouch',
    minPackPriceInr: 25,
    defaultEssential: true,
  },
  salt: {
    canonicalName: 'salt',
    pricePerBaseUnit: 0.03,
    baseUnit: 'g',
    minPackQty: 500,
    minPackLabel: '500g pack',
    minPackPriceInr: 15,
    defaultEssential: true,
  },
  turmeric: {
    canonicalName: 'turmeric',
    pricePerBaseUnit: 0.3,
    baseUnit: 'g',
    minPackQty: 50,
    minPackLabel: '50g pouch',
    minPackPriceInr: 15,
    defaultEssential: false,
  },
  cumin: {
    canonicalName: 'cumin',
    pricePerBaseUnit: 0.5,
    baseUnit: 'g',
    minPackQty: 50,
    minPackLabel: '50g pouch',
    minPackPriceInr: 25,
    defaultEssential: false,
  },
  'garam masala': {
    canonicalName: 'garam masala',
    pricePerBaseUnit: 0.6,
    baseUnit: 'g',
    minPackQty: 20,
    minPackLabel: 'small ₹10–15 pouch',
    minPackPriceInr: 15,
    defaultEssential: false,
  },
  'red chilli powder': {
    canonicalName: 'red chilli powder',
    pricePerBaseUnit: 0.35,
    baseUnit: 'g',
    minPackQty: 50,
    minPackLabel: '50g pouch',
    minPackPriceInr: 18,
    defaultEssential: false,
  },
  'soy sauce': {
    canonicalName: 'soy sauce',
    pricePerBaseUnit: 0.25,
    baseUnit: 'ml',
    minPackQty: 90,
    minPackLabel: 'small bottle (90ml)',
    minPackPriceInr: 25,
    defaultEssential: false,
  },
  ketchup: {
    canonicalName: 'ketchup',
    pricePerBaseUnit: 0.18,
    baseUnit: 'g',
    minPackQty: 90,
    minPackLabel: 'small pouch (90g)',
    minPackPriceInr: 15,
    defaultEssential: false,
  },
};

const PANTRY_SPICE_CANONICALS = new Set([
  'turmeric',
  'cumin',
  'garam masala',
  'red chilli powder',
  'salt',
]);

export const BASIC_INDIAN_SPICES = [
  { canonicalName: 'turmeric', displayName: 'Turmeric (Haldi)', defaultQty: 100, unit: 'g' },
  { canonicalName: 'red chilli powder', displayName: 'Red Chilli Powder (Lal Mirch)', defaultQty: 100, unit: 'g' },
  { canonicalName: 'cumin', displayName: 'Cumin (Jeera)', defaultQty: 100, unit: 'g' },
  { canonicalName: 'garam masala', displayName: 'Garam Masala', defaultQty: 50, unit: 'g' },
  { canonicalName: 'salt', displayName: 'Salt (Namak)', defaultQty: 500, unit: 'g' },
];

export interface RecipeCostBreakdown {
  requiredIngredients: RecipeIngredient[];
  availableIngredients: string[];
  missingIngredients: RecipePurchaseItem[];
  /** Estimated INR value of ingredients consumed from existing kitchen stock */
  ingredientConsumptionValueInr: number;
  /** Prorated INR value of the missing portions actually used in the dish */
  missingIngredientValueInr: number;
  /** Actual estimated shop bill in INR accounting for practical retail pack sizes */
  actualShoppingOutlayInr: number;
  estimatedPurchaseCostText: string;
  usesExistingOnly: boolean;
  fitsActiveBudget: boolean;
}

function getCatalogEntry(canonicalName: string, rawName: string): IngredientCatalogEntry {
  if (INGREDIENT_CATALOG[canonicalName]) {
    return INGREDIENT_CATALOG[canonicalName];
  }
  const lower = rawName.toLowerCase();
  if (lower.includes('spice') || lower.includes('masala') || lower.includes('powder')) {
    return {
      canonicalName,
      pricePerBaseUnit: 0.4,
      baseUnit: 'g',
      minPackQty: 25,
      minPackLabel: 'small pouch',
      minPackPriceInr: 15,
      defaultEssential: false,
    };
  }
  if (lower.includes('oil')) {
    return INGREDIENT_CATALOG['cooking oil'];
  }
  return {
    canonicalName,
    pricePerBaseUnit: 0.1,
    baseUnit: 'g',
    minPackQty: 100,
    minPackLabel: '100g pack',
    minPackPriceInr: 15,
    defaultEssential: true,
  };
}

function convertToCatalogBase(
  qty: number,
  unit: string,
  entry: IngredientCatalogEntry,
): number {
  const base = toBaseQuantity(qty, unit);
  if (entry.baseUnit === 'g') {
    if (base.family === 'mass') return base.baseQty;
    if (base.family === 'volume') return base.baseQty; // water-equivalent fallback for tbsp/tsp spices
    if (base.baseUnit === 'pieces' && entry.gramsPerPiece) return base.baseQty * entry.gramsPerPiece;
    return qty * 50;
  }
  if (entry.baseUnit === 'ml') {
    if (base.family === 'volume') return base.baseQty;
    if (base.family === 'mass') return base.baseQty;
    return qty * 15;
  }
  if (entry.baseUnit === 'pieces') {
    if (base.baseUnit === 'pieces') return base.baseQty;
    if (base.family === 'mass' && entry.gramsPerPiece) return Math.max(1, base.baseQty / entry.gramsPerPiece);
    return qty;
  }
  if (entry.baseUnit === 'packets') {
    return base.baseUnit === 'packets' ? base.baseQty : Math.max(1, qty);
  }
  if (entry.baseUnit === 'bunch') {
    return base.baseUnit === 'bunch' ? base.baseQty : 1;
  }
  return qty;
}

function resolveAvailableStockForIngredient(
  inventory: InventoryItem[],
  ingName: string,
  canonicalName: string,
  entry: IngredientCatalogEntry,
): { matchedItem?: InventoryItem; availableInCatalogBase: number } {
  const rawLower = cleanRawIngredientName(ingName);
  const candidates = inventory.filter((item) => {
    const itemCanonical = (item.canonicalName || normalizeIngredientMeta(item.name).canonicalName).toLowerCase();
    const itemRaw = cleanRawIngredientName(item.displayName || item.name);
    return (
      itemCanonical === canonicalName ||
      itemRaw === rawLower ||
      (canonicalName.length >= 3 && itemRaw.includes(canonicalName))
    );
  });

  // Prefer available item with positive stock
  const availableMatch = candidates.find(
    (c) => c.isAvailable && (c.numericQuantity === undefined || c.numericQuantity > 0),
  );
  const matchedItem = availableMatch || candidates[0];

  if (!matchedItem || !matchedItem.isAvailable || matchedItem.numericQuantity === 0) {
    return { matchedItem, availableInCatalogBase: 0 };
  }

  const parsed =
    matchedItem.numericQuantity !== undefined && matchedItem.unit
      ? { numericQuantity: matchedItem.numericQuantity, unit: normalizeUnit(matchedItem.unit) }
      : parseQuantityString(matchedItem.quantity, entry.baseUnit);

  const availableInCatalogBase = convertToCatalogBase(parsed.numericQuantity, parsed.unit, entry);
  return { matchedItem, availableInCatalogBase };
}

function formatOutlayRange(totalOutlay: number): string {
  if (totalOutlay <= 0) return '₹0 (No shopping needed)';
  const rounded = Math.round(totalOutlay);
  const low = Math.max(5, Math.floor((rounded * 0.9) / 5) * 5);
  const high = Math.max(low + 5, Math.ceil((rounded * 1.15) / 5) * 5);
  return low === high ? `₹${low}` : `₹${low}–${high}`;
}

/**
 * SINGLE SOURCE OF TRUTH for recipe ingredient availability and cost calculation.
 * Used identically by Chat Dish Discovery cards, Detailed Recipe Modal, Servings Scaler, and Budget Negotiation.
 */
export function calculateRecipeCostBreakdown(
  rawIngredients: RecipeIngredient[],
  inventory: InventoryItem[],
  activeBudget: number | null = null,
): RecipeCostBreakdown {
  const availableIngredients: string[] = [];
  const missingIngredients: RecipePurchaseItem[] = [];
  const normalizedIngredients: RecipeIngredient[] = [];

  let ingredientConsumptionValueInr = 0;
  let missingIngredientValueInr = 0;
  let actualShoppingOutlayInr = 0;

  for (const raw of rawIngredients) {
    if (!raw || !raw.name?.trim()) continue;
    const meta = normalizeIngredientMeta(raw.name);
    const canonicalName = (raw.canonicalName || meta.canonicalName).toLowerCase();
    const entry = getCatalogEntry(canonicalName, raw.name);

    const parsedQty =
      raw.numericQuantity !== undefined && raw.numericQuantity > 0 && raw.unit
        ? { numericQuantity: raw.numericQuantity, unit: normalizeUnit(raw.unit) }
        : parseQuantityString(raw.quantity || '1', entry.baseUnit);

    const isEssential =
      raw.isEssential !== undefined ? Boolean(raw.isEssential) : entry.defaultEssential ?? true;

    const neededBase = Math.max(
      0.1,
      convertToCatalogBase(parsedQty.numericQuantity, parsedQty.unit, entry),
    );

    const { matchedItem, availableInCatalogBase } = resolveAvailableStockForIngredient(
      inventory,
      raw.name,
      canonicalName,
      entry,
    );

    const cleanDisplayQty =
      raw.quantity && raw.quantity.trim()
        ? raw.quantity.trim()
        : formatQuantity(parsedQty.numericQuantity, parsedQty.unit);

    normalizedIngredients.push({
      name: raw.name.trim(),
      canonicalName,
      quantity: cleanDisplayQty,
      numericQuantity: parsedQty.numericQuantity,
      unit: parsedQty.unit,
      isEssential,
      ...(raw.notes ? { notes: raw.notes } : {}),
    });

    const usedFromStockBase = Math.min(neededBase, availableInCatalogBase);
    const missingBase = Math.max(0, neededBase - availableInCatalogBase);

    if (usedFromStockBase > 0) {
      ingredientConsumptionValueInr += usedFromStockBase * entry.pricePerBaseUnit;
    }

    if (missingBase <= 0.01) {
      const label = matchedItem
        ? `${raw.name.trim()} (${cleanDisplayQty} needed · ${matchedItem.quantity} in kitchen)`
        : `${raw.name.trim()} (${cleanDisplayQty})`;
      availableIngredients.push(label);
    } else {
      // Partial stock note if some exists in kitchen
      if (usedFromStockBase > 0 && matchedItem) {
        availableIngredients.push(
          `${raw.name.trim()} (${matchedItem.quantity} in kitchen · partial)`,
        );
      }

      const portionCost = Math.max(1, Math.round(missingBase * entry.pricePerBaseUnit));
      missingIngredientValueInr += portionCost;

      const packsNeeded = Math.max(1, Math.ceil(missingBase / entry.minPackQty));
      const packOutlay = Math.max(5, Math.round(packsNeeded * entry.minPackPriceInr));
      actualShoppingOutlayInr += packOutlay;

      const packLabel =
        packsNeeded > 1 ? `${packsNeeded} × ${entry.minPackLabel}` : entry.minPackLabel;
      const missingText =
        usedFromStockBase > 0
          ? `${Math.round(missingBase)}${entry.baseUnit === 'pieces' ? ' pcs' : entry.baseUnit} short`
          : cleanDisplayQty;

      missingIngredients.push({
        name: raw.name.trim(),
        canonicalName,
        quantity: `${missingText} (buy ${packLabel})`,
        neededQuantity: cleanDisplayQty,
        purchasePackQuantity: packLabel,
        estimatedPriceRange: `₹${packOutlay}`,
        estimatedCostInr: packOutlay,
        portionCostInr: portionCost,
        isEssential,
      });
    }
  }

  const roundedConsumption = Math.round(ingredientConsumptionValueInr);
  const roundedMissingVal = Math.round(missingIngredientValueInr);
  const roundedOutlay = Math.round(actualShoppingOutlayInr);

  return {
    requiredIngredients: normalizedIngredients,
    availableIngredients,
    missingIngredients,
    ingredientConsumptionValueInr: roundedConsumption,
    missingIngredientValueInr: roundedMissingVal,
    actualShoppingOutlayInr: roundedOutlay,
    estimatedPurchaseCostText: formatOutlayRange(roundedOutlay),
    usesExistingOnly: roundedOutlay === 0,
    fitsActiveBudget: activeBudget === null ? true : roundedOutlay <= activeBudget,
  };
}

/**
 * Deterministically trims optional missing ingredients if doing so helps satisfy a strict budget,
 * WITHOUT ever dropping essential ingredients (never falsifying ₹0).
 */
export function optimizeOptionalIngredientsForBudget(
  rawIngredients: RecipeIngredient[],
  inventory: InventoryItem[],
  activeBudget: number | null,
): {
  optimizedIngredients: RecipeIngredient[];
  breakdown: RecipeCostBreakdown;
  droppedOptionalNames: string[];
} {
  const initial = calculateRecipeCostBreakdown(rawIngredients, inventory, activeBudget);
  if (activeBudget === null || initial.fitsActiveBudget) {
    return {
      optimizedIngredients: initial.requiredIngredients,
      breakdown: initial,
      droppedOptionalNames: [],
    };
  }

  // Drop only missing OPTIONAL items (never drop available items or essential items)
  const missingOptionalCanonicals = new Set(
    initial.missingIngredients.filter((m) => !m.isEssential).map((m) => m.canonicalName || m.name.toLowerCase()),
  );

  if (missingOptionalCanonicals.size === 0) {
    return {
      optimizedIngredients: initial.requiredIngredients,
      breakdown: initial,
      droppedOptionalNames: [],
    };
  }

  const droppedOptionalNames: string[] = [];
  const filtered = initial.requiredIngredients.filter((ing) => {
    const canon = (ing.canonicalName || normalizeIngredientMeta(ing.name).canonicalName).toLowerCase();
    if (!ing.isEssential && missingOptionalCanonicals.has(canon)) {
      droppedOptionalNames.push(ing.name);
      return false;
    }
    return true;
  });

  const recalculated = calculateRecipeCostBreakdown(filtered, inventory, activeBudget);
  return {
    optimizedIngredients: recalculated.requiredIngredients,
    breakdown: recalculated,
    droppedOptionalNames,
  };
}

/**
 * Scales recipe ingredients deterministically when servings change (e.g. 2 -> 4)
 * and recalculates the complete cost breakdown using the same engine.
 */
export function scaleRecipeWithCost(
  ingredients: RecipeIngredient[],
  fromServings: number,
  toServings: number,
  inventory: InventoryItem[],
  activeBudget: number | null = null,
): RecipeCostBreakdown {
  const safeFrom = Math.max(1, fromServings || 2);
  const safeTo = Math.max(1, toServings || 2);
  const factor = safeTo / safeFrom;

  const scaled = ingredients.map((ing) => {
    const parsed =
      ing.numericQuantity !== undefined && ing.unit
        ? { numericQuantity: ing.numericQuantity, unit: normalizeUnit(ing.unit) }
        : parseQuantityString(ing.quantity, 'g');
    const rawScaled = parsed.numericQuantity * factor;
    const roundedScaled =
      parsed.unit === 'pieces' || parsed.unit === 'packets' || parsed.unit === 'bunch'
        ? Math.max(1, Math.round(rawScaled))
        : Math.max(0.5, Math.round(rawScaled * 10) / 10);

    return {
      ...ing,
      numericQuantity: roundedScaled,
      unit: parsed.unit,
      quantity: formatQuantity(roundedScaled, parsed.unit),
    };
  });

  return calculateRecipeCostBreakdown(scaled, inventory, activeBudget);
}

/**
 * Checks if a user message during recipe/dish negotiation states that missing oil/spices
 * are already available at home ("Oil toh ghar mein hai", "Masale bhi hain").
 */
export function detectHomeAvailableClaims(
  text: string,
  currentMissingNames: string[] = [],
): Array<{ canonicalName: string; displayName: string; quantity: number; unit: string }> {
  const lower = text.toLowerCase();
  const claims: Array<{ canonicalName: string; displayName: string; quantity: number; unit: string }> = [];
  const isAtHomeStatement =
    /\b(already\s*hai|ghar\s*(mein|pe|par)\s*hai|toh\s*(ghar\s*mein\s*)?hai|bhi\s*hai|hai\s*ghar|have\s*(it|oil|spices|masala)|hain\b)/i.test(
      lower,
    ) && !/\b(khatam|nahi\s*hai|out\s*of\s*stock|chahiye|lana)\b/i.test(lower);

  if (!isAtHomeStatement) return claims;

  if (/\b(oil|tel|sarso|mustard oil|refined oil)\b/i.test(lower)) {
    claims.push({
      canonicalName: 'cooking oil',
      displayName: 'Cooking Oil (Tel)',
      quantity: 500,
      unit: 'ml',
    });
  }

  if (/\b(masala|masale|spices?|haldi|mirch|jeera|namak)\b/i.test(lower)) {
    const missingLower = currentMissingNames.map((n) => n.toLowerCase());
    if (/\b(masala|masale|spices?)\b/i.test(lower)) {
      for (const sp of BASIC_INDIAN_SPICES) {
        if (
          missingLower.length === 0 ||
          missingLower.some(
            (m) =>
              m.includes(sp.canonicalName) ||
              m.includes('spice') ||
              m.includes('masala') ||
              PANTRY_SPICE_CANONICALS.has(normalizeIngredientMeta(m).canonicalName),
          )
        ) {
          claims.push({
            canonicalName: sp.canonicalName,
            displayName: sp.displayName,
            quantity: sp.defaultQty,
            unit: sp.unit,
          });
        }
      }
    } else {
      for (const sp of BASIC_INDIAN_SPICES) {
        if (
          (sp.canonicalName === 'turmeric' && /\bhaldi|turmeric\b/i.test(lower)) ||
          (sp.canonicalName === 'red chilli powder' && /\bmirch|chilli\b/i.test(lower)) ||
          (sp.canonicalName === 'cumin' && /\bjeera|cumin\b/i.test(lower)) ||
          (sp.canonicalName === 'salt' && /\bnamak|salt\b/i.test(lower))
        ) {
          claims.push({
            canonicalName: sp.canonicalName,
            displayName: sp.displayName,
            quantity: sp.defaultQty,
            unit: sp.unit,
          });
        }
      }
    }
  }

  return claims;
}
