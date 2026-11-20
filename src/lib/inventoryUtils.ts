import type { DetectedInventoryAction, InventoryCategory, InventoryItem } from '../types';

interface CanonicalDef {
  canonical: string;
  display: string;
  category: InventoryCategory;
  defaultUnit: string;
  aliases: string[];
}

const CANONICAL_INGREDIENTS: CanonicalDef[] = [
  {
    canonical: 'potato',
    display: 'Potato (Aloo)',
    category: 'Vegetables',
    defaultUnit: 'g',
    aliases: ['potato', 'potatoes', 'aloo', 'alu', 'batata'],
  },
  {
    canonical: 'onion',
    display: 'Onion (Pyaaz)',
    category: 'Vegetables',
    defaultUnit: 'pieces',
    aliases: ['onion', 'onions', 'pyaaz', 'pyaj', 'piaz', 'kanda'],
  },
  {
    canonical: 'tomato',
    display: 'Tomato (Tamatar)',
    category: 'Vegetables',
    defaultUnit: 'pieces',
    aliases: ['tomato', 'tomatoes', 'tamatar', 'tamaatar'],
  },
  {
    canonical: 'milk',
    display: 'Milk (Doodh)',
    category: 'Dairy',
    defaultUnit: 'ml',
    aliases: ['milk', 'doodh', 'dudh'],
  },
  {
    canonical: 'paneer',
    display: 'Paneer',
    category: 'Dairy',
    defaultUnit: 'g',
    aliases: ['paneer', 'cottage cheese'],
  },
  {
    canonical: 'curd',
    display: 'Curd (Dahi)',
    category: 'Dairy',
    defaultUnit: 'g',
    aliases: ['curd', 'dahi', 'yogurt', 'yoghurt'],
  },
  {
    canonical: 'butter',
    display: 'Butter (Makkhan)',
    category: 'Dairy',
    defaultUnit: 'g',
    aliases: ['butter', 'makkhan'],
  },
  {
    canonical: 'cheese',
    display: 'Cheese',
    category: 'Dairy',
    defaultUnit: 'g',
    aliases: ['cheese', 'cheddar', 'mozzarella'],
  },
  {
    canonical: 'rice',
    display: 'Rice (Chawal)',
    category: 'Rice',
    defaultUnit: 'g',
    aliases: ['rice', 'chawal', 'basmati', 'basmati rice'],
  },
  {
    canonical: 'wheat flour',
    display: 'Wheat Flour (Atta)',
    category: 'Grains',
    defaultUnit: 'g',
    aliases: ['atta', 'aata', 'wheat flour', 'gehu atta', 'flour'],
  },
  {
    canonical: 'bread',
    display: 'Bread / Pav',
    category: 'Grains',
    defaultUnit: 'pieces',
    aliases: ['bread', 'pav', 'loaf', 'bun'],
  },
  {
    canonical: 'egg',
    display: 'Eggs (Anda)',
    category: 'Eggs and meat',
    defaultUnit: 'pieces',
    aliases: ['egg', 'eggs', 'anda', 'ande', 'andaa'],
  },
  {
    canonical: 'chicken',
    display: 'Chicken',
    category: 'Eggs and meat',
    defaultUnit: 'g',
    aliases: ['chicken', 'murga'],
  },
  {
    canonical: 'green chilli',
    display: 'Green Chilli (Hari Mirch)',
    category: 'Vegetables',
    defaultUnit: 'pieces',
    aliases: ['green chilli', 'green chillies', 'hari mirch', 'mirch', 'mirchi', 'chilli'],
  },
  {
    canonical: 'coriander',
    display: 'Coriander (Dhaniya)',
    category: 'Vegetables',
    defaultUnit: 'bunch',
    aliases: ['coriander', 'coriander leaves', 'dhaniya', 'hara dhaniya', 'cilantro'],
  },
  {
    canonical: 'ginger',
    display: 'Ginger (Adrak)',
    category: 'Vegetables',
    defaultUnit: 'g',
    aliases: ['ginger', 'adrak'],
  },
  {
    canonical: 'garlic',
    display: 'Garlic (Lehsun)',
    category: 'Vegetables',
    defaultUnit: 'g',
    aliases: ['garlic', 'lehsun', 'lahsun', 'lasan'],
  },
  {
    canonical: 'capsicum',
    display: 'Capsicum (Shimla Mirch)',
    category: 'Vegetables',
    defaultUnit: 'pieces',
    aliases: ['capsicum', 'shimla mirch', 'bell pepper'],
  },
  {
    canonical: 'peas',
    display: 'Green Peas (Matar)',
    category: 'Vegetables',
    defaultUnit: 'g',
    aliases: ['peas', 'green peas', 'matar'],
  },
  {
    canonical: 'maggi',
    display: 'Maggi Noodles',
    category: 'Other',
    defaultUnit: 'packets',
    aliases: ['maggi', 'maggie', 'instant noodles', 'noodles'],
  },
  {
    canonical: 'cooking oil',
    display: 'Cooking Oil (Tel)',
    category: 'Other',
    defaultUnit: 'ml',
    aliases: ['oil', 'cooking oil', 'tel', 'mustard oil', 'refined oil', 'sarso tel', 'sarson ka tel', 'sarso ka tel'],
  },
  {
    canonical: 'ghee',
    display: 'Desi Ghee',
    category: 'Dairy',
    defaultUnit: 'ml',
    aliases: ['ghee', 'desi ghee'],
  },
  {
    canonical: 'salt',
    display: 'Salt (Namak)',
    category: 'Spices',
    defaultUnit: 'g',
    aliases: ['salt', 'namak'],
  },
  {
    canonical: 'turmeric',
    display: 'Turmeric (Haldi)',
    category: 'Spices',
    defaultUnit: 'g',
    aliases: ['turmeric', 'haldi', 'turmeric powder'],
  },
  {
    canonical: 'cumin',
    display: 'Cumin (Jeera)',
    category: 'Spices',
    defaultUnit: 'g',
    aliases: ['cumin', 'jeera', 'zeera'],
  },
  {
    canonical: 'garam masala',
    display: 'Garam Masala',
    category: 'Spices',
    defaultUnit: 'g',
    aliases: ['garam masala', 'masala', 'masale', 'spices', 'basic spice kit', 'spice kit'],
  },
  {
    canonical: 'red chilli powder',
    display: 'Red Chilli Powder (Lal Mirch)',
    category: 'Spices',
    defaultUnit: 'g',
    aliases: ['red chilli powder', 'lal mirch', 'chilli powder'],
  },
  {
    canonical: 'dal',
    display: 'Dal (Lentils)',
    category: 'Pulses',
    defaultUnit: 'g',
    aliases: ['dal', 'daal', 'lentils', 'toor dal', 'moong dal', 'masoor dal', 'arhar dal'],
  },
  {
    canonical: 'soy sauce',
    display: 'Soy Sauce',
    category: 'Sauces',
    defaultUnit: 'ml',
    aliases: ['soy sauce', 'soya sauce'],
  },
  {
    canonical: 'ketchup',
    display: 'Tomato Ketchup',
    category: 'Sauces',
    defaultUnit: 'g',
    aliases: ['ketchup', 'tomato ketchup', 'sauce'],
  },
];

export function cleanRawIngredientName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRawName(raw: string): string {
  return cleanRawIngredientName(raw);
}

export function normalizeIngredientMeta(
  rawName: string,
  fallbackCategory: InventoryCategory = 'Other',
): {
  canonicalName: string;
  displayName: string;
  category: InventoryCategory;
  defaultUnit: string;
} {
  const cleaned = cleanRawName(rawName);
  for (const def of CANONICAL_INGREDIENTS) {
    if (def.canonical === cleaned || def.aliases.includes(cleaned)) {
      return {
        canonicalName: def.canonical,
        displayName: def.display,
        category: def.category,
        defaultUnit: def.defaultUnit,
      };
    }
  }
  for (const def of CANONICAL_INGREDIENTS) {
    if (def.aliases.some((alias) => cleaned.includes(alias) && alias.length >= 3)) {
      return {
        canonicalName: def.canonical,
        displayName: def.display,
        category: def.category,
        defaultUnit: def.defaultUnit,
      };
    }
  }

  const titleCased = rawName.trim().replace(/\s+/g, ' ');
  return {
    canonicalName: cleaned || 'ingredient',
    displayName: titleCased ? titleCased.charAt(0).toUpperCase() + titleCased.slice(1) : 'Ingredient',
    category: fallbackCategory,
    defaultUnit: 'g',
  };
}

export function makeCanonicalDocId(canonicalName: string): string {
  const slug = canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `inv_${slug || 'item'}`;
}

export function normalizeUnit(rawUnit?: string | null): string {
  const u = (rawUnit || '').toLowerCase().trim();
  if (!u) return 'unit';
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return 'g';
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].includes(u)) return 'kg';
  if (['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'].includes(u)) return 'ml';
  if (['l', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(u)) return 'L';
  if (['pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'unit', 'units', 'count'].includes(u)) {
    return 'pieces';
  }
  if (['pkt', 'pkts', 'packet', 'packets', 'pack', 'packs', 'pouch', 'sachet'].includes(u)) {
    return 'packets';
  }
  if (['tbsp', 'tablespoon', 'tablespoons'].includes(u)) return 'tbsp';
  if (['tsp', 'teaspoon', 'teaspoons'].includes(u)) return 'tsp';
  if (['cup', 'cups', 'katori'].includes(u)) return 'cups';
  if (['bunch', 'bunches', 'gaddi'].includes(u)) return 'bunch';
  return u.slice(0, 20);
}

export function parseQuantityString(qtyStr: string, fallbackUnit = 'unit'): {
  numericQuantity: number;
  unit: string;
} {
  const cleaned = (qtyStr || '').trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
  if (!match) {
    return { numericQuantity: 1, unit: normalizeUnit(fallbackUnit) };
  }
  const num = Number(match[1]);
  const unit = normalizeUnit(match[2] || fallbackUnit);
  return {
    numericQuantity: Number.isFinite(num) && num >= 0 ? num : 1,
    unit,
  };
}

export function formatQuantity(num: number, unit: string): string {
  const rounded = Math.round(num * 100) / 100;
  const cleanUnit = normalizeUnit(unit);
  if (cleanUnit === 'g' || cleanUnit === 'kg' || cleanUnit === 'ml' || cleanUnit === 'L') {
    return `${rounded}${cleanUnit}`;
  }
  if (cleanUnit === 'pieces' && rounded === 1) return '1 piece';
  if (cleanUnit === 'packets' && rounded === 1) return '1 packet';
  return `${rounded} ${cleanUnit}`;
}

/**
 * Converts a quantity + unit into base unit ('g' for mass, 'ml' for volume, or same unit).
 */
export function toBaseQuantity(num: number, rawUnit: string): {
  baseQty: number;
  baseUnit: string;
  family: 'mass' | 'volume' | 'other';
} {
  const unit = normalizeUnit(rawUnit);
  if (unit === 'kg') return { baseQty: num * 1000, baseUnit: 'g', family: 'mass' };
  if (unit === 'g') return { baseQty: num, baseUnit: 'g', family: 'mass' };
  if (unit === 'L') return { baseQty: num * 1000, baseUnit: 'ml', family: 'volume' };
  if (unit === 'ml') return { baseQty: num, baseUnit: 'ml', family: 'volume' };
  if (unit === 'tbsp') return { baseQty: num * 15, baseUnit: 'ml', family: 'volume' };
  if (unit === 'tsp') return { baseQty: num * 5, baseUnit: 'ml', family: 'volume' };
  if (unit === 'cups') return { baseQty: num * 240, baseUnit: 'ml', family: 'volume' };
  return { baseQty: num, baseUnit: unit, family: 'other' };
}

/**
 * Formats base quantity back into the cleanest unit (e.g., 1000g -> 1kg if exact, 700g -> 700g, 850g -> 850g).
 */
export function fromBaseQuantity(
  baseQty: number,
  baseUnit: string,
  preferLargeIfClean = false,
): { numericQuantity: number; unit: string; quantityText: string } {
  const safe = Math.max(0, Math.round(baseQty * 100) / 100);
  if (baseUnit === 'g' && safe >= 1000 && (preferLargeIfClean || safe % 1000 === 0 || safe >= 2000)) {
    const kg = Math.round((safe / 1000) * 100) / 100;
    return { numericQuantity: kg, unit: 'kg', quantityText: formatQuantity(kg, 'kg') };
  }
  if (baseUnit === 'ml' && safe >= 1000 && (preferLargeIfClean || safe % 1000 === 0 || safe >= 2000)) {
    const l = Math.round((safe / 1000) * 100) / 100;
    return { numericQuantity: l, unit: 'L', quantityText: formatQuantity(l, 'L') };
  }
  return { numericQuantity: safe, unit: baseUnit, quantityText: formatQuantity(safe, baseUnit) };
}

export function combineQuantities(
  existingNum: number,
  existingUnit: string,
  deltaNum: number,
  deltaUnit: string,
  operation: 'add' | 'subtract' | 'set',
): { numericQuantity: number; unit: string; quantityText: string; deltaInStoredUnit: number } {
  if (operation === 'set') {
    const normU = normalizeUnit(deltaUnit);
    const safeVal = Math.max(0, Math.round(deltaNum * 100) / 100);
    return {
      numericQuantity: safeVal,
      unit: normU,
      quantityText: formatQuantity(safeVal, normU),
      deltaInStoredUnit: safeVal - existingNum,
    };
  }

  const a = toBaseQuantity(existingNum, existingUnit);
  const b = toBaseQuantity(deltaNum, deltaUnit);

  if (a.family === b.family && a.family !== 'other') {
    const nextBase = operation === 'add' ? a.baseQty + b.baseQty : Math.max(0, a.baseQty - b.baseQty);
    const formatted = fromBaseQuantity(nextBase, a.baseUnit, false);
    return {
      ...formatted,
      deltaInStoredUnit: operation === 'add' ? b.baseQty : -Math.min(a.baseQty, b.baseQty),
    };
  }

  // Fallback when units belong to incompatible families (e.g. cups vs pieces): operate if same unit, else convert to incoming unit cleanly
  if (normalizeUnit(existingUnit) === normalizeUnit(deltaUnit)) {
    const next = operation === 'add' ? existingNum + deltaNum : Math.max(0, existingNum - deltaNum);
    const u = normalizeUnit(existingUnit);
    return {
      numericQuantity: Math.round(next * 100) / 100,
      unit: u,
      quantityText: formatQuantity(next, u),
      deltaInStoredUnit: operation === 'add' ? deltaNum : -Math.min(existingNum, deltaNum),
    };
  }

  // If existing is 0 or unavailable and adding with a new unit, adopt the new unit
  if (existingNum <= 0 && operation === 'add') {
    const u = normalizeUnit(deltaUnit);
    return {
      numericQuantity: Math.round(deltaNum * 100) / 100,
      unit: u,
      quantityText: formatQuantity(deltaNum, u),
      deltaInStoredUnit: deltaNum,
    };
  }

  const u = normalizeUnit(existingUnit);
  const next = operation === 'add' ? existingNum + deltaNum : Math.max(0, existingNum - deltaNum);
  return {
    numericQuantity: Math.round(next * 100) / 100,
    unit: u,
    quantityText: formatQuantity(next, u),
    deltaInStoredUnit: operation === 'add' ? deltaNum : -Math.min(existingNum, deltaNum),
  };
}

export function findMatchingInventoryItem(
  inventory: InventoryItem[],
  ingredientName: string,
): InventoryItem | undefined {
  const { canonicalName } = normalizeIngredientMeta(ingredientName);
  const rawLower = cleanRawName(ingredientName);

  return inventory.find((item) => {
    const itemCanonical = (item.canonicalName || normalizeIngredientMeta(item.name).canonicalName).toLowerCase();
    const itemRaw = cleanRawName(item.displayName || item.name);
    return itemCanonical === canonicalName || itemRaw === rawLower || itemRaw.includes(canonicalName);
  });
}

/**
 * Deterministic fallback parser so common inventory commands work even when Gemini is temporarily unavailable (503).
 */
export function parseOfflineInventoryCommand(text: string): DetectedInventoryAction[] {
  const lower = text.toLowerCase().trim();
  const results: DetectedInventoryAction[] = [];

  // Check "khatam" / "finished" / "out of stock"
  const outMatch = lower.match(/([a-z\s]+?)\s+(?:khatam|khallas|finished|out of stock|over|nahi hai)/i);
  if (outMatch) {
    const rawIng = outMatch[1].replace(/\b(bhai|yaar|mera|ghar mein|fridge mein)\b/gi, '').trim();
    if (rawIng.length >= 2) {
      const meta = normalizeIngredientMeta(rawIng);
      results.push({
        action: 'MARK_UNAVAILABLE',
        ingredient: meta.displayName,
        canonicalName: meta.canonicalName,
        quantity: 0,
        unit: meta.defaultUnit,
        category: meta.category,
        confidence: 0.85,
      });
      return results;
    }
  }

  // Check "use kar liya" / "used" / "consumed"
  const consumeMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams|kg|ml|l|pcs|pieces|packet|packets)?\s+([a-z\s]+?)\s+(?:use kar liya|used|consumed|nikal liya|daal diya)/i,
  );
  if (consumeMatch) {
    const qty = Number(consumeMatch[1]);
    const rawIng = consumeMatch[3].trim();
    const meta = normalizeIngredientMeta(rawIng);
    const unit = normalizeUnit(consumeMatch[2] || meta.defaultUnit);
    results.push({
      action: 'CONSUME_INGREDIENT',
      ingredient: meta.displayName,
      canonicalName: meta.canonicalName,
      quantity: qty,
      unit,
      category: meta.category,
      confidence: 0.9,
    });
    return results;
  }

  // Check "laya" / "le aaya" / "kharida" / "bought" / "liya"
  const addMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams|kg|ml|l|pcs|pieces|packet|packets|pkt)?\s+([a-z\s]+?)\s+(?:le aaya|laya|laaya|kharida|liya|bought|added|bhi le aaya)/i,
  );
  if (addMatch) {
    const qty = Number(addMatch[1]);
    const rawIng = addMatch[3].replace(/\b(bhi|abhi|aur|market se)\b/gi, '').trim();
    const meta = normalizeIngredientMeta(rawIng);
    const unit = normalizeUnit(addMatch[2] || meta.defaultUnit);
    results.push({
      action: 'ADD_INGREDIENT',
      ingredient: meta.displayName,
      canonicalName: meta.canonicalName,
      quantity: qty,
      unit,
      category: meta.category,
      confidence: 0.9,
      isPurchase: true,
    });
    return results;
  }

  return results;
}
