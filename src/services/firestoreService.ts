import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError } from '../lib/firebase';
import {
  combineQuantities,
  findMatchingInventoryItem,
  formatQuantity,
  makeCanonicalDocId,
  normalizeIngredientMeta,
  normalizeUnit,
  parseQuantityString,
} from '../lib/inventoryUtils';
import {
  FIELD_LIMITS,
  OperationType,
  type AppliedInventoryResult,
  type ChatMessage,
  type ConversationState,
  type DetectedInventoryAction,
  type DetectedPreferenceUpdates,
  type DiscoveryContext,
  type InventoryCategory,
  type InventoryItem,
  type InventoryTransaction,
  type InventoryTransactionAction,
  type InventoryTransactionSource,
  type SavedRecipe,
  type UserProfile,
} from '../types';

function clampString(val: string, maxLen: number, fallback = ''): string {
  const trimmed = (val || fallback).trim();
  return trimmed.slice(0, maxLen) || fallback;
}

function clampStringList(list: string[], maxItems: number, maxItemLen = 60): string[] {
  return list
    .map((s) => s.trim().slice(0, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function toMillis(ts: unknown): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts && typeof ts === 'object' && 'seconds' in ts) {
    return Number((ts as { seconds: number }).seconds) * 1000;
  }
  return 0;
}

export function generateDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeLoadedInventoryItem(raw: InventoryItem): InventoryItem {
  const meta = normalizeIngredientMeta(raw.displayName || raw.name, raw.category);
  const parsed =
    raw.numericQuantity !== undefined && raw.unit
      ? { numericQuantity: raw.numericQuantity, unit: normalizeUnit(raw.unit) }
      : parseQuantityString(raw.quantity, meta.defaultUnit);
  return {
    ...raw,
    canonicalName: raw.canonicalName || meta.canonicalName,
    displayName: raw.displayName || raw.name,
    numericQuantity: parsed.numericQuantity,
    unit: parsed.unit,
  };
}

export async function ensureUserProfile(user: User, fallbackName?: string): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      return {
        ...existing,
        defaultBudget: existing.hasExplicitDefaultBudget ? (existing.defaultBudget ?? null) : null,
        hasExplicitDefaultBudget: Boolean(existing.hasExplicitDefaultBudget),
        humourLevel: existing.humourLevel || 'Friendly teasing',
        conversationStyle: existing.conversationStyle || 'Warm & Detailed',
        memoryNotes: existing.memoryNotes || [],
        conversationState: existing.conversationState || 'IDLE',
        discoveryContext: existing.discoveryContext || {},
      };
    }

    const displayName = clampString(
      user.displayName || fallbackName || user.email?.split('@')[0] || 'Chef',
      FIELD_LIMITS.DISPLAY_NAME_MAX,
      'Chef',
    );
    const email = clampString(user.email || 'user@khanabanana.app', 160, 'user@khanabanana.app');

    const newProfile: UserProfile = {
      uid: user.uid,
      displayName,
      email,
      buddyName: 'KhanaBanana',
      humourLevel: 'Friendly teasing',
      conversationStyle: 'Warm & Detailed',
      preferredLanguage: 'Hinglish',
      dietaryPreference: 'Vegetarian',
      spiceTolerance: 'Medium',
      favouriteCuisines: ['North Indian', 'Street Food', 'Everyday Bachelor'],
      allergies: [],
      dislikedIngredients: [],
      defaultEquipment: 'Gas Stove',
      defaultUtensils: 'One Pan / Kadhai',
      defaultServings: 2,
      preferredPrepTime: '15-30 mins',
      defaultBudget: null,
      hasExplicitDefaultBudget: false,
      recentMeals: [],
      memoryNotes: [],
      conversationState: 'IDLE',
      discoveryContext: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(ref, newProfile);
    return newProfile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as UserProfile;
      onData({
        ...data,
        defaultBudget: data.hasExplicitDefaultBudget ? (data.defaultBudget ?? null) : null,
        hasExplicitDefaultBudget: Boolean(data.hasExplicitDefaultBudget),
        humourLevel: data.humourLevel || 'Friendly teasing',
        conversationStyle: data.conversationStyle || 'Warm & Detailed',
        memoryNotes: data.memoryNotes || [],
        conversationState: data.conversationState || 'IDLE',
        discoveryContext: data.discoveryContext || {},
      });
    },
    (err) => handleFirestoreError(err, OperationType.GET, path),
  );
}

export async function updateUserPreferences(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'buddyName'
      | 'humourLevel'
      | 'conversationStyle'
      | 'preferredLanguage'
      | 'dietaryPreference'
      | 'spiceTolerance'
      | 'favouriteCuisines'
      | 'allergies'
      | 'dislikedIngredients'
      | 'defaultEquipment'
      | 'defaultUtensils'
      | 'defaultServings'
      | 'preferredPrepTime'
      | 'defaultBudget'
      | 'hasExplicitDefaultBudget'
    >
  >,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const sanitized: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.displayName !== undefined) {
      sanitized.displayName = clampString(updates.displayName, FIELD_LIMITS.DISPLAY_NAME_MAX, 'Chef');
    }
    if (updates.buddyName !== undefined) {
      sanitized.buddyName = clampString(updates.buddyName, FIELD_LIMITS.BUDDY_NAME_MAX, 'KhanaBanana');
    }
    if (updates.humourLevel !== undefined) sanitized.humourLevel = updates.humourLevel;
    if (updates.conversationStyle !== undefined) sanitized.conversationStyle = updates.conversationStyle;
    if (updates.preferredLanguage !== undefined) sanitized.preferredLanguage = updates.preferredLanguage;
    if (updates.dietaryPreference !== undefined) sanitized.dietaryPreference = updates.dietaryPreference;
    if (updates.spiceTolerance !== undefined) sanitized.spiceTolerance = updates.spiceTolerance;
    if (updates.favouriteCuisines !== undefined) {
      sanitized.favouriteCuisines = clampStringList(updates.favouriteCuisines, FIELD_LIMITS.CUISINES_MAX);
    }
    if (updates.allergies !== undefined) {
      sanitized.allergies = clampStringList(updates.allergies, FIELD_LIMITS.ALLERGIES_MAX);
    }
    if (updates.dislikedIngredients !== undefined) {
      sanitized.dislikedIngredients = clampStringList(updates.dislikedIngredients, FIELD_LIMITS.DISLIKED_MAX);
    }
    if (updates.defaultEquipment !== undefined) sanitized.defaultEquipment = updates.defaultEquipment;
    if (updates.defaultUtensils !== undefined) sanitized.defaultUtensils = updates.defaultUtensils;
    if (updates.defaultServings !== undefined) {
      sanitized.defaultServings = Math.max(1, Math.min(12, Math.round(updates.defaultServings)));
    }
    if (updates.preferredPrepTime !== undefined) sanitized.preferredPrepTime = updates.preferredPrepTime;
    if (updates.defaultBudget !== undefined) {
      sanitized.defaultBudget =
        updates.defaultBudget === null
          ? null
          : Math.max(0, Math.min(10000, Math.round(Number(updates.defaultBudget) || 0)));
    }
    if (updates.hasExplicitDefaultBudget !== undefined) {
      sanitized.hasExplicitDefaultBudget = Boolean(updates.hasExplicitDefaultBudget);
    }

    await updateDoc(doc(db, 'users', uid), sanitized);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateRecentMeals(uid: string, currentMeals: string[], addMeals: string[]): Promise<void> {
  const path = `users/${uid}`;
  try {
    const normalizedNew = addMeals.map((m) => m.trim()).filter(Boolean);
    const merged = Array.from(new Set([...normalizedNew, ...currentMeals])).slice(
      0,
      FIELD_LIMITS.RECENT_MEALS_MAX,
    );
    await updateDoc(doc(db, 'users', uid), {
      recentMeals: clampStringList(merged, FIELD_LIMITS.RECENT_MEALS_MAX, 80),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateMemoryNotes(uid: string, nextNotes: string[]): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      memoryNotes: clampStringList(nextNotes, FIELD_LIMITS.MEMORY_NOTES_MAX, 140),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function applyPersistentMemoryUpdates(
  uid: string,
  profile: UserProfile,
  updates?: DetectedPreferenceUpdates,
  recentMealsToAdd: string[] = [],
): Promise<void> {
  const path = `users/${uid}`;
  const payload: Record<string, unknown> = {};

  if (recentMealsToAdd.length > 0) {
    const normalizedNew = recentMealsToAdd.map((m) => m.trim()).filter(Boolean);
    if (normalizedNew.length > 0) {
      const merged = Array.from(new Set([...normalizedNew, ...(profile.recentMeals || [])]));
      payload.recentMeals = clampStringList(merged, FIELD_LIMITS.RECENT_MEALS_MAX, 80);
    }
  }

  if (updates) {
    if (
      updates.spiceTolerance &&
      ['Mild', 'Medium', 'Spicy', 'Extra Spicy'].includes(updates.spiceTolerance)
    ) {
      payload.spiceTolerance = updates.spiceTolerance;
    }
    if (
      updates.dietaryPreference &&
      ['Vegetarian', 'Non-Vegetarian', 'Eggetarian', 'Vegan'].includes(updates.dietaryPreference)
    ) {
      payload.dietaryPreference = updates.dietaryPreference;
    }
    if (updates.addFavouriteCuisines?.length) {
      const merged = Array.from(
        new Set([...(profile.favouriteCuisines || []), ...updates.addFavouriteCuisines]),
      );
      payload.favouriteCuisines = clampStringList(merged, FIELD_LIMITS.CUISINES_MAX, 60);
    }
    if (updates.addAllergies?.length) {
      const merged = Array.from(new Set([...(profile.allergies || []), ...updates.addAllergies]));
      payload.allergies = clampStringList(merged, FIELD_LIMITS.ALLERGIES_MAX, 60);
    }
    if (updates.addDislikedIngredients?.length) {
      const merged = Array.from(
        new Set([...(profile.dislikedIngredients || []), ...updates.addDislikedIngredients]),
      );
      payload.dislikedIngredients = clampStringList(merged, FIELD_LIMITS.DISLIKED_MAX, 60);
    }
    if (updates.addMemoryNotes?.length) {
      const merged = Array.from(
        new Set([...updates.addMemoryNotes, ...(profile.memoryNotes || [])]),
      );
      payload.memoryNotes = clampStringList(merged, FIELD_LIMITS.MEMORY_NOTES_MAX, 140);
    }
  }

  if (Object.keys(payload).length === 0) return;

  try {
    payload.updatedAt = serverTimestamp();
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateConversationContext(
  uid: string,
  conversationState: ConversationState,
  discoveryContext: DiscoveryContext,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const cleanCtx: Record<string, unknown> = {};
    if (discoveryContext.mood) cleanCtx.mood = clampString(discoveryContext.mood, 120);
    if (discoveryContext.craving) cleanCtx.craving = clampString(discoveryContext.craving, 120);
    if (discoveryContext.recentMealNote) cleanCtx.recentMealNote = clampString(discoveryContext.recentMealNote, 160);
    if (discoveryContext.timeAvailable) cleanCtx.timeAvailable = clampString(discoveryContext.timeAvailable, 60);
    if (discoveryContext.shoppingPreference) cleanCtx.shoppingPreference = clampString(discoveryContext.shoppingPreference, 80);
    if (discoveryContext.activeBudget !== undefined) {
      cleanCtx.activeBudget =
        discoveryContext.activeBudget === null
          ? null
          : Math.max(0, Math.min(10000, Number(discoveryContext.activeBudget) || 0));
    }
    if (discoveryContext.lastSuggestedDishes?.length) {
      cleanCtx.lastSuggestedDishes = discoveryContext.lastSuggestedDishes.slice(0, 3).map((d) => ({
        dishName: clampString(d.dishName, 120, 'Homemade Dish'),
        cuisine: clampString(d.cuisine, 60, 'Indian'),
        shortPitch: clampString(d.shortPitch, 200, ''),
        prepCookTime: clampString(d.prepCookTime, 40, '20 mins'),
        ...(d.servings !== undefined ? { servings: Number(d.servings) } : {}),
        estimatedExtraCostInr: Number(d.estimatedExtraCostInr || 0),
        usesExistingOnly: Boolean(
          d.usesExistingOnly !== undefined
            ? d.usesExistingOnly
            : Number(d.estimatedExtraCostInr || 0) === 0,
        ),
        matchReason: clampString(d.matchReason, 200, ''),
        imageCategory: d.imageCategory || 'kitchen',
        ...(d.requiredIngredients?.length ? { requiredIngredients: d.requiredIngredients.slice(0, 25) } : {}),
        ...(d.availableIngredients?.length ? { availableIngredients: d.availableIngredients.slice(0, 25) } : {}),
        ...(d.missingIngredients?.length ? { missingIngredients: d.missingIngredients.slice(0, 20) } : {}),
        ...(d.ingredientConsumptionValueInr !== undefined
          ? { ingredientConsumptionValueInr: Number(d.ingredientConsumptionValueInr) }
          : {}),
        ...(d.missingIngredientValueInr !== undefined
          ? { missingIngredientValueInr: Number(d.missingIngredientValueInr) }
          : {}),
        ...(d.actualShoppingOutlayInr !== undefined
          ? { actualShoppingOutlayInr: Number(d.actualShoppingOutlayInr) }
          : {}),
        ...(d.fitsActiveBudget !== undefined ? { fitsActiveBudget: Boolean(d.fitsActiveBudget) } : {}),
        ...(d.substitutionsNote ? { substitutionsNote: clampString(d.substitutionsNote, 200) } : {}),
      }));
    }
    if (discoveryContext.rejectedDishes?.length) {
      cleanCtx.rejectedDishes = clampStringList(discoveryContext.rejectedDishes, 15, 100);
    }
    if (discoveryContext.selectedDishName) {
      cleanCtx.selectedDishName = clampString(discoveryContext.selectedDishName, 120);
    }
    if (typeof discoveryContext.turnsInDiscovery === 'number') {
      cleanCtx.turnsInDiscovery = Math.max(0, Math.min(20, Math.round(discoveryContext.turnsInDiscovery)));
    }

    await updateDoc(doc(db, 'users', uid), {
      conversationState,
      discoveryContext: cleanCtx,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// =============================================================================
// Kitchen Inventory & Atomic Audit Log Transactions
// =============================================================================
export function subscribeInventory(
  uid: string,
  onData: (items: InventoryItem[]) => void,
): Unsubscribe {
  const path = `users/${uid}/inventory`;
  const q = query(collection(db, 'users', uid, 'inventory'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => normalizeLoadedInventoryItem(d.data() as InventoryItem));
      items.sort((a, b) => a.name.localeCompare(b.name));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export function subscribeInventoryTransactions(
  uid: string,
  onData: (txs: InventoryTransaction[]) => void,
): Unsubscribe {
  const path = `users/${uid}/inventoryTransactions`;
  const q = query(collection(db, 'users', uid, 'inventoryTransactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const txs = snap.docs.map((d) => d.data() as InventoryTransaction);
      txs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(txs.slice(0, 60));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

async function fetchUserInventorySnapshot(uid: string): Promise<InventoryItem[]> {
  const q = query(collection(db, 'users', uid, 'inventory'), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeLoadedInventoryItem(d.data() as InventoryItem));
}

export async function applyInventoryActionTransaction(
  uid: string,
  action: DetectedInventoryAction,
  source: InventoryTransactionSource = 'chat',
  customNote?: string,
): Promise<AppliedInventoryResult> {
  const meta = normalizeIngredientMeta(
    action.canonicalName || action.ingredient,
    action.category || 'Other',
  );

  if (action.action === 'NO_INVENTORY_ACTION' || action.action === 'QUERY_INVENTORY') {
    return {
      action: action.action,
      ingredient: action.ingredient,
      canonicalName: meta.canonicalName,
      displayName: meta.displayName,
      status: 'skipped',
      message: 'No mutation required.',
    };
  }

  if (action.needsClarification) {
    return {
      action: action.action,
      ingredient: action.ingredient,
      canonicalName: meta.canonicalName,
      displayName: meta.displayName,
      status: 'needs_clarification',
      message: action.clarificationQuestion || `How much ${meta.displayName} should I update?`,
    };
  }

  const currentInventory = await fetchUserInventorySnapshot(uid);
  const existingMatch = findMatchingInventoryItem(currentInventory, action.canonicalName || action.ingredient);
  const targetItemId = existingMatch ? existingMatch.id : makeCanonicalDocId(meta.canonicalName);
  const itemRef = doc(db, 'users', uid, 'inventory', targetItemId);
  const txId = generateDocId('tx');
  const txRef = doc(db, 'users', uid, 'inventoryTransactions', txId);

  const incomingNum =
    action.quantity !== undefined && action.quantity !== null && Number.isFinite(action.quantity)
      ? Math.max(0, Number(action.quantity))
      : undefined;
  const incomingUnit = normalizeUnit(action.unit || existingMatch?.unit || meta.defaultUnit);

  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(itemRef);
      const exists = snap.exists();
      const currentData = exists ? normalizeLoadedInventoryItem(snap.data() as InventoryItem) : null;
      const prevNum = currentData?.numericQuantity ?? 0;
      const prevUnit = currentData?.unit || incomingUnit;
      const prevText = currentData?.quantity || '0';

      if (action.action === 'REMOVE_INGREDIENT') {
        if (!exists) {
          return {
            action: action.action,
            ingredient: action.ingredient,
            canonicalName: meta.canonicalName,
            displayName: meta.displayName,
            status: 'skipped' as const,
            message: `${meta.displayName} was not in your kitchen.`,
          };
        }
        tx.delete(itemRef);
        tx.set(txRef, {
          id: txId,
          userId: uid,
          itemId: targetItemId,
          ingredientName: currentData?.displayName || meta.displayName,
          canonicalName: meta.canonicalName,
          actionType: 'MANUAL_REMOVE' satisfies InventoryTransactionAction,
          deltaQuantity: -prevNum,
          unit: prevUnit,
          previousQuantity: prevNum,
          newQuantity: 0,
          source,
          note: clampString(customNote || `Removed ${meta.displayName}`, 200),
          createdAt: serverTimestamp(),
        });
        return {
          action: action.action,
          ingredient: action.ingredient,
          canonicalName: meta.canonicalName,
          displayName: currentData?.displayName || meta.displayName,
          previousQtyText: prevText,
          newQtyText: 'Removed',
          status: 'applied' as const,
          message: `Removed ${currentData?.displayName || meta.displayName} from My Kitchen.`,
        };
      }

      if (action.action === 'MARK_UNAVAILABLE') {
        if (!exists) {
          tx.set(itemRef, {
            id: targetItemId,
            userId: uid,
            canonicalName: meta.canonicalName,
            displayName: meta.displayName,
            name: meta.displayName,
            numericQuantity: 0,
            unit: incomingUnit,
            quantity: formatQuantity(0, incomingUnit),
            category: action.category || meta.category,
            isRegular: false,
            isAvailable: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(itemRef, {
            canonicalName: meta.canonicalName,
            displayName: currentData?.displayName || meta.displayName,
            numericQuantity: 0,
            unit: prevUnit,
            quantity: formatQuantity(0, prevUnit),
            isAvailable: false,
            updatedAt: serverTimestamp(),
          });
        }
        tx.set(txRef, {
          id: txId,
          userId: uid,
          itemId: targetItemId,
          ingredientName: currentData?.displayName || meta.displayName,
          canonicalName: meta.canonicalName,
          actionType: 'MARK_UNAVAILABLE' satisfies InventoryTransactionAction,
          deltaQuantity: -prevNum,
          unit: prevUnit,
          previousQuantity: prevNum,
          newQuantity: 0,
          source,
          note: clampString(customNote || `Marked ${meta.displayName} out of stock`, 200),
          createdAt: serverTimestamp(),
        });
        return {
          action: action.action,
          ingredient: action.ingredient,
          canonicalName: meta.canonicalName,
          displayName: currentData?.displayName || meta.displayName,
          previousQtyText: prevText,
          newQtyText: 'Out of stock (0)',
          status: 'applied' as const,
          message: `Marked ${currentData?.displayName || meta.displayName} as out of stock.`,
        };
      }

      const qtyToUse = incomingNum ?? 1;
      let combined;
      let txActionType: InventoryTransactionAction = 'PURCHASE';

      if (action.action === 'CONSUME_INGREDIENT') {
        combined = combineQuantities(prevNum, prevUnit, qtyToUse, incomingUnit, 'subtract');
        txActionType = 'CONSUMPTION';
      } else if (action.action === 'UPDATE_QUANTITY') {
        combined = combineQuantities(prevNum, prevUnit, qtyToUse, incomingUnit, 'set');
        txActionType = 'QUANTITY_CORRECTION';
      } else {
        // ADD_INGREDIENT or RESTOCK_INGREDIENT
        combined = combineQuantities(prevNum, prevUnit, qtyToUse, incomingUnit, 'add');
        txActionType =
          action.action === 'RESTOCK_INGREDIENT'
            ? 'RESTOCK'
            : action.isPurchase
              ? 'PURCHASE'
              : source === 'manual_ui'
                ? 'MANUAL_ADD'
                : 'PURCHASE';
      }

      const nextAvailable = combined.numericQuantity > 0;
      const finalDisplayName = currentData?.displayName || meta.displayName;
      const finalCategory = currentData?.category || action.category || meta.category;

      if (!exists) {
        tx.set(itemRef, {
          id: targetItemId,
          userId: uid,
          canonicalName: meta.canonicalName,
          displayName: finalDisplayName,
          name: finalDisplayName,
          numericQuantity: combined.numericQuantity,
          unit: combined.unit,
          quantity: combined.quantityText,
          category: finalCategory,
          isRegular: false,
          isAvailable: nextAvailable,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(itemRef, {
          canonicalName: meta.canonicalName,
          displayName: finalDisplayName,
          name: finalDisplayName,
          numericQuantity: combined.numericQuantity,
          unit: combined.unit,
          quantity: combined.quantityText,
          isAvailable: nextAvailable,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(txRef, {
        id: txId,
        userId: uid,
        itemId: targetItemId,
        ingredientName: finalDisplayName,
        canonicalName: meta.canonicalName,
        actionType: txActionType,
        deltaQuantity: Math.round((combined.numericQuantity - prevNum) * 100) / 100,
        unit: combined.unit,
        previousQuantity: prevNum,
        newQuantity: combined.numericQuantity,
        source,
        note: clampString(
          customNote ||
            `${txActionType === 'CONSUMPTION' ? 'Used' : 'Updated'} ${finalDisplayName}: ${prevText} → ${combined.quantityText}`,
          200,
        ),
        createdAt: serverTimestamp(),
      });

      return {
        action: action.action,
        ingredient: action.ingredient,
        canonicalName: meta.canonicalName,
        displayName: finalDisplayName,
        previousQtyText: exists ? prevText : '0',
        newQtyText: combined.quantityText,
        status: 'applied' as const,
        message: `${finalDisplayName}: ${exists ? `${prevText} → ` : ''}${combined.quantityText}`,
      };
    });

    return result;
  } catch (err) {
    console.error('Inventory transaction failed:', err);
    return {
      action: action.action,
      ingredient: action.ingredient,
      canonicalName: meta.canonicalName,
      displayName: meta.displayName,
      status: 'failed',
      message: `Failed to save ${meta.displayName} update to database.`,
    };
  }
}

export async function consumeIngredientsBatch(
  uid: string,
  itemsToConsume: { name: string; quantity: number; unit: string }[],
  dishName: string,
): Promise<AppliedInventoryResult[]> {
  const results: AppliedInventoryResult[] = [];
  for (const item of itemsToConsume) {
    if (!item.quantity || item.quantity <= 0) continue;
    const res = await applyInventoryActionTransaction(
      uid,
      {
        action: 'CONSUME_INGREDIENT',
        ingredient: item.name,
        quantity: item.quantity,
        unit: item.unit,
        confidence: 1,
      },
      'cooking_mode',
      `Cooked ${dishName}: used ${formatQuantity(item.quantity, item.unit)} ${item.name}`,
    );
    results.push(res);
  }
  return results;
}

export async function addInventoryItem(
  uid: string,
  item: Omit<InventoryItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const meta = normalizeIngredientMeta(item.name, item.category);
  const parsed = parseQuantityString(item.quantity, meta.defaultUnit);
  const res = await applyInventoryActionTransaction(
    uid,
    {
      action: item.isAvailable ? 'ADD_INGREDIENT' : 'MARK_UNAVAILABLE',
      ingredient: item.name.trim(),
      canonicalName: meta.canonicalName,
      quantity: parsed.numericQuantity,
      unit: parsed.unit,
      category: item.category,
      confidence: 1,
      isPurchase: false,
    },
    'manual_ui',
    `Manual add: ${item.name} (${item.quantity})`,
  );

  // Also persist isRegular flag if set
  if (item.isRegular) {
    const inv = await fetchUserInventorySnapshot(uid);
    const match = findMatchingInventoryItem(inv, meta.canonicalName);
    if (match) {
      await updateDoc(doc(db, 'users', uid, 'inventory', match.id), {
        isRegular: true,
        updatedAt: serverTimestamp(),
      });
    }
  }
  return res.canonicalName;
}

export async function updateInventoryItem(
  uid: string,
  itemId: string,
  updates: Partial<Pick<InventoryItem, 'name' | 'quantity' | 'category' | 'isRegular' | 'isAvailable'>>,
): Promise<void> {
  const itemRef = doc(db, 'users', uid, 'inventory', itemId);
  const path = `users/${uid}/inventory/${itemId}`;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(itemRef);
      if (!snap.exists()) return;
      const current = normalizeLoadedInventoryItem(snap.data() as InventoryItem);
      const prevNum = current.numericQuantity ?? 0;
      const prevUnit = current.unit || 'unit';

      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      let nextNum = prevNum;
      let nextUnit = prevUnit;
      let actionType: InventoryTransactionAction = 'QUANTITY_CORRECTION';
      let note = `Updated ${current.displayName || current.name}`;

      if (updates.name !== undefined) {
        const cleanName = clampString(updates.name, FIELD_LIMITS.ITEM_NAME_MAX, 'Item');
        const meta = normalizeIngredientMeta(cleanName, current.category);
        payload.name = cleanName;
        payload.displayName = cleanName;
        payload.canonicalName = meta.canonicalName;
      }
      if (updates.quantity !== undefined) {
        const parsed = parseQuantityString(updates.quantity, prevUnit);
        nextNum = parsed.numericQuantity;
        nextUnit = parsed.unit;
        payload.numericQuantity = nextNum;
        payload.unit = nextUnit;
        payload.quantity = formatQuantity(nextNum, nextUnit);
        payload.isAvailable = nextNum > 0;
        note = `Adjusted ${current.displayName || current.name}: ${current.quantity} → ${payload.quantity}`;
      }
      if (updates.category !== undefined) payload.category = updates.category;
      if (updates.isRegular !== undefined) payload.isRegular = Boolean(updates.isRegular);
      if (updates.isAvailable !== undefined) {
        payload.isAvailable = Boolean(updates.isAvailable);
        if (!updates.isAvailable) {
          actionType = 'MARK_UNAVAILABLE';
          note = `Marked ${current.displayName || current.name} out of stock`;
        } else {
          actionType = 'RESTOCK';
          if (nextNum === 0) {
            nextNum = 1;
            payload.numericQuantity = 1;
            payload.quantity = formatQuantity(1, nextUnit);
          }
          note = `Marked ${current.displayName || current.name} in stock`;
        }
      }

      tx.update(itemRef, payload);

      if (updates.quantity !== undefined || updates.isAvailable !== undefined) {
        const txId = generateDocId('tx');
        tx.set(doc(db, 'users', uid, 'inventoryTransactions', txId), {
          id: txId,
          userId: uid,
          itemId,
          ingredientName: current.displayName || current.name,
          canonicalName: current.canonicalName || normalizeIngredientMeta(current.name).canonicalName,
          actionType,
          deltaQuantity: Math.round((nextNum - prevNum) * 100) / 100,
          unit: nextUnit,
          previousQuantity: prevNum,
          newQuantity: nextNum,
          source: 'manual_ui' satisfies InventoryTransactionSource,
          note: clampString(note, 200),
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteInventoryItem(uid: string, itemId: string): Promise<void> {
  const itemRef = doc(db, 'users', uid, 'inventory', itemId);
  const path = `users/${uid}/inventory/${itemId}`;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(itemRef);
      if (!snap.exists()) return;
      const current = normalizeLoadedInventoryItem(snap.data() as InventoryItem);
      const prevNum = current.numericQuantity ?? 0;
      const txId = generateDocId('tx');
      tx.delete(itemRef);
      tx.set(doc(db, 'users', uid, 'inventoryTransactions', txId), {
        id: txId,
        userId: uid,
        itemId,
        ingredientName: current.displayName || current.name,
        canonicalName: current.canonicalName || normalizeIngredientMeta(current.name).canonicalName,
        actionType: 'MANUAL_REMOVE' satisfies InventoryTransactionAction,
        deltaQuantity: -prevNum,
        unit: current.unit || 'unit',
        previousQuantity: prevNum,
        newQuantity: 0,
        source: 'manual_ui' satisfies InventoryTransactionSource,
        note: `Deleted ${current.displayName || current.name} from My Kitchen`,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// =============================================================================
// Chat Messages
// =============================================================================
export function subscribeMessages(
  uid: string,
  onData: (messages: ChatMessage[]) => void,
): Unsubscribe {
  const path = `users/${uid}/messages`;
  const q = query(collection(db, 'users', uid, 'messages'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs.map((d) => d.data() as ChatMessage);
      msgs.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(msgs);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export async function addChatMessage(
  uid: string,
  msg: Omit<ChatMessage, 'id' | 'userId' | 'createdAt'>,
): Promise<string> {
  const id = generateDocId('msg');
  const path = `users/${uid}/messages/${id}`;
  try {
    const docData: Record<string, unknown> = {
      id,
      userId: uid,
      role: msg.role,
      content: clampString(msg.content, FIELD_LIMITS.MESSAGE_MAX, '...'),
      buddyNameSnapshot: clampString(msg.buddyNameSnapshot, FIELD_LIMITS.BUDDY_NAME_MAX, 'KhanaBanana'),
      createdAt: serverTimestamp(),
    };
    if (msg.budgetLimit !== undefined) docData.budgetLimit = Number(msg.budgetLimit);
    if (msg.shoppingSummary !== undefined) docData.shoppingSummary = msg.shoppingSummary;
    if (msg.suggestedDishes !== undefined) docData.suggestedDishes = msg.suggestedDishes.slice(0, 5);
    if (msg.inventoryResults !== undefined && msg.inventoryResults.length > 0) {
      docData.inventoryResults = msg.inventoryResults.slice(0, 20);
    }
    if (msg.attachedRecipeId !== undefined) docData.attachedRecipeId = msg.attachedRecipeId;
    if (msg.responseMode !== undefined) docData.responseMode = msg.responseMode;
    if (msg.selectedDishName !== undefined) {
      docData.selectedDishName = clampString(msg.selectedDishName, 120);
    }

    await setDoc(doc(db, 'users', uid, 'messages', id), docData);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function attachRecipeToMessage(uid: string, messageId: string, recipeId: string): Promise<void> {
  const path = `users/${uid}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'messages', messageId), {
      attachedRecipeId: recipeId.slice(0, 128),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateMessageInventoryResults(
  uid: string,
  messageId: string,
  inventoryResults: AppliedInventoryResult[],
): Promise<void> {
  const path = `users/${uid}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'messages', messageId), {
      inventoryResults: inventoryResults.slice(0, 20),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function clearChatHistory(uid: string, messageIds: string[]): Promise<void> {
  const path = `users/${uid}/messages`;
  try {
    // Scope strictly to active conversation messages inside users/{uid}/messages.
    // Never delete users/{uid}, inventory, inventoryTransactions, or saved recipes.
    const q = query(collection(db, 'users', uid, 'messages'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const allMessageIds = Array.from(
      new Set([...messageIds, ...snap.docs.map((d) => d.id)]),
    ).filter(Boolean);

    for (let i = 0; i < allMessageIds.length; i += 400) {
      const chunk = allMessageIds.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        batch.delete(doc(db, 'users', uid, 'messages', id));
      });
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// =============================================================================
// Saved Recipes
// =============================================================================
export function subscribeRecipes(
  uid: string,
  onData: (recipes: SavedRecipe[]) => void,
): Unsubscribe {
  const path = `users/${uid}/recipes`;
  const q = query(collection(db, 'users', uid, 'recipes'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const recipes = snap.docs.map((d) => d.data() as SavedRecipe);
      recipes.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(recipes);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export async function saveGeneratedRecipe(
  uid: string,
  recipe: Omit<SavedRecipe, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
): Promise<SavedRecipe> {
  const id = generateDocId('rec');
  const path = `users/${uid}/recipes/${id}`;
  try {
    const payload: SavedRecipe = {
      ...recipe,
      id,
      userId: uid,
      dishName: clampString(recipe.dishName, 120, 'Homemade Dish'),
      cuisine: clampString(recipe.cuisine, 60, 'Indian'),
      description: clampString(recipe.description, 1500, 'Tasty home-cooked meal.'),
      servings: Math.max(1, Math.min(20, Math.round(recipe.servings || 2))),
      prepTime: clampString(recipe.prepTime, 60, '10 mins'),
      cookTime: clampString(recipe.cookTime, 60, '20 mins'),
      estimatedPurchaseCost: clampString(recipe.estimatedPurchaseCost, 80, '₹0'),
      ...(recipe.ingredientConsumptionValueInr !== undefined
        ? { ingredientConsumptionValueInr: Number(recipe.ingredientConsumptionValueInr) }
        : {}),
      ...(recipe.missingIngredientValueInr !== undefined
        ? { missingIngredientValueInr: Number(recipe.missingIngredientValueInr) }
        : {}),
      ...(recipe.actualShoppingOutlayInr !== undefined
        ? { actualShoppingOutlayInr: Number(recipe.actualShoppingOutlayInr) }
        : {}),
      ...(recipe.appliedBudgetLimit !== undefined
        ? { appliedBudgetLimit: recipe.appliedBudgetLimit }
        : {}),
      applianceGuidance: clampString(recipe.applianceGuidance, 1200, 'Cook on medium heat.'),
      storageGuidance: clampString(recipe.storageGuidance, 1200, 'Store in an airtight container.'),
      exactIngredients: recipe.exactIngredients.slice(0, 40),
      existingIngredients: recipe.existingIngredients.slice(0, 40),
      ingredientsToPurchase: recipe.ingredientsToPurchase.slice(0, 30),
      requiredUtensils: recipe.requiredUtensils.slice(0, 15),
      steps: recipe.steps.slice(0, 30),
      tasteEnhancers: recipe.tasteEnhancers.slice(0, 15),
      substitutions: recipe.substitutions.slice(0, 15),
      commonMistakes: recipe.commonMistakes.slice(0, 15),
      isSaved: Boolean(recipe.isSaved),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'users', uid, 'recipes', id), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSavedRecipeBreakdown(
  uid: string,
  recipeId: string,
  updates: Pick<
    SavedRecipe,
    | 'servings'
    | 'exactIngredients'
    | 'existingIngredients'
    | 'ingredientsToPurchase'
    | 'estimatedPurchaseCost'
    | 'ingredientConsumptionValueInr'
    | 'missingIngredientValueInr'
    | 'actualShoppingOutlayInr'
    | 'appliedBudgetLimit'
  >,
): Promise<void> {
  const path = `users/${uid}/recipes/${recipeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'recipes', recipeId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleRecipeSaved(uid: string, recipeId: string, isSaved: boolean): Promise<void> {
  const path = `users/${uid}/recipes/${recipeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'recipes', recipeId), {
      isSaved,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteSavedRecipe(uid: string, recipeId: string): Promise<void> {
  const path = `users/${uid}/recipes/${recipeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'recipes', recipeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
