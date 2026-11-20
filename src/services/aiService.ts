import type {
  ChatMessage,
  ChatResponseMode,
  ConversationState,
  DetectedInventoryAction,
  DetectedPreferenceUpdates,
  DiscoveryContext,
  InventoryItem,
  InventoryTransaction,
  RecipeIngredient,
  SavedRecipe,
  ShoppingSummary,
  SuggestedDish,
  UserProfile,
} from '../types';

export interface AiChatResponse {
  intentMode: ChatResponseMode;
  nextConversationState: ConversationState;
  updatedDiscoveryContext?: DiscoveryContext;
  selectedDishName?: string;
  reply: string;
  inventoryActions: DetectedInventoryAction[];
  includeBudgetPlan: boolean;
  budgetPlan?: ShoppingSummary;
  suggestedDishes: SuggestedDish[];
  detectedMealsEatenRecently: string[];
  detectedPreferenceUpdates?: DetectedPreferenceUpdates;
}

export class AiServiceError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 500, retryable = true) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.retryable = retryable;
  }
}

async function parseErrorResponse(response: Response, fallbackMsg: string): Promise<AiServiceError> {
  try {
    const data = await response.json();
    const rawMsg = typeof data?.error === 'string' ? data.error : fallbackMsg;
    // Guard against any accidental raw JSON error string
    const cleanMsg = rawMsg.trim().startsWith('{')
      ? 'AI service is temporarily busy. Please tap Retry in a moment.'
      : rawMsg;
    return new AiServiceError(
      cleanMsg,
      response.status,
      data?.retryable !== undefined ? Boolean(data.retryable) : response.status >= 500 || response.status === 429,
    );
  } catch {
    return new AiServiceError(fallbackMsg, response.status, response.status >= 500 || response.status === 429);
  }
}

export async function sendChatMessageToAi(params: {
  message: string;
  history: ChatMessage[];
  profile: UserProfile;
  inventory: InventoryItem[];
  recentTransactions?: InventoryTransaction[];
  activeBudgetOverride?: number | null;
  conversationState?: ConversationState;
  discoveryContext?: DiscoveryContext;
}): Promise<AiChatResponse> {
  // Find last suggested shopping list from recent assistant messages
  const lastShoppingMsg = [...params.history]
    .reverse()
    .find((m) => m.role === 'assistant' && m.shoppingSummary?.itemsToBuy?.length);

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        history: params.history.slice(-14).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        profile: params.profile,
        inventory: params.inventory.map((i) => ({
          name: i.name,
          canonicalName: i.canonicalName,
          displayName: i.displayName,
          quantity: i.quantity,
          numericQuantity: i.numericQuantity,
          unit: i.unit,
          category: i.category,
          isRegular: i.isRegular,
          isAvailable: i.isAvailable,
        })),
        recentTransactions: (params.recentTransactions || []).slice(0, 8).map((t) => ({
          ingredientName: t.ingredientName,
          actionType: t.actionType,
          deltaQuantity: t.deltaQuantity,
          unit: t.unit,
          note: t.note,
        })),
        lastSuggestedShoppingList:
          lastShoppingMsg?.shoppingSummary?.itemsToBuy.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            estimatedCostInr: i.estimatedCostInr,
          })) || [],
        activeBudgetOverride: params.activeBudgetOverride,
        conversationState: params.conversationState || params.profile.conversationState || 'IDLE',
        discoveryContext: params.discoveryContext || params.profile.discoveryContext || {},
      }),
    });
  } catch {
    throw new AiServiceError(
      'Network connection interrupted. Your message is safe — tap Retry once connected.',
      0,
      true,
    );
  }

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to get response from your food buddy.');
  }
  return (await response.json()) as AiChatResponse;
}

export async function generateFullRecipe(params: {
  dishName: string;
  profile: UserProfile;
  inventory: InventoryItem[];
  conversationContext?: string;
  servingsOverride?: number;
  equipmentOverride?: string;
  utensilsOverride?: string;
  budgetOverride?: number | null;
  selectedDishBlueprint?: SuggestedDish;
  lockedIngredients?: RecipeIngredient[];
}): Promise<Omit<SavedRecipe, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'isSaved'>> {
  let response: Response;
  try {
    response = await fetch('/api/recipe/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dishName: params.dishName,
        profile: params.profile,
        inventory: params.inventory.map((i) => ({
          name: i.name,
          canonicalName: i.canonicalName,
          displayName: i.displayName,
          quantity: i.quantity,
          numericQuantity: i.numericQuantity,
          unit: i.unit,
          category: i.category,
          isRegular: i.isRegular,
          isAvailable: i.isAvailable,
        })),
        conversationContext: params.conversationContext,
        servingsOverride: params.servingsOverride,
        equipmentOverride: params.equipmentOverride,
        utensilsOverride: params.utensilsOverride,
        budgetOverride: params.budgetOverride,
        selectedDishBlueprint: params.selectedDishBlueprint,
        lockedIngredients: params.lockedIngredients,
      }),
    });
  } catch {
    throw new AiServiceError('Network issue while building recipe. Please try again.', 0, true);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to generate recipe.');
  }
  return await response.json();
}

export async function askCookingAssistant(params: {
  question: string;
  recipe: SavedRecipe;
  currentStepIndex: number;
  buddyName: string;
  preferredLanguage: string;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/cooking/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new AiServiceError('Network issue reaching cooking assistant. Please retry.', 0, true);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to reach cooking assistant.');
  }
  const data = await response.json();
  return data.answer as string;
}
