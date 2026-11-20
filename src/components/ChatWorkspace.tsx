import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChefHat,
  IndianRupee,
  Loader2,
  PackageCheck,
  RefreshCw,
  Send,
  ShoppingBasket,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import {
  normalizeIngredientMeta,
  parseOfflineInventoryCommand,
  parseQuantityString,
} from '../lib/inventoryUtils';
import { getDishImage, MEDIA_ASSETS } from '../lib/mediaAssets';
import { sendChatMessageToAi } from '../services/aiService';
import {
  addChatMessage,
  applyInventoryActionTransaction,
  applyPersistentMemoryUpdates,
  attachRecipeToMessage,
  clearChatHistory,
  updateConversationContext,
} from '../services/firestoreService';
import type {
  AppliedInventoryResult,
  ChatMessage,
  ConversationState,
  InventoryItem,
  InventoryTransaction,
  SavedRecipe,
  ShoppingListItem,
  SuggestedDish,
  UserProfile,
} from '../types';
import { SafeImage } from './SafeImage';

interface ChatWorkspaceProps {
  profile: UserProfile;
  inventory: InventoryItem[];
  recentTransactions: InventoryTransaction[];
  messages: ChatMessage[];
  recipes: SavedRecipe[];
  onGenerateAndOpenRecipe: (
    dish: SuggestedDish,
    contextSummary: string,
    budgetLimit: number | null,
    messageId?: string,
    inventoryOverride?: InventoryItem[],
  ) => Promise<string | undefined>;
  onOpenRecipeById: (recipeId: string) => void;
  onGoToKitchen: () => void;
}

interface FailedTurnState {
  userMessageText: string;
  userMessageId: string;
  errorMessage: string;
  retryable: boolean;
  offlineInventoryApplied: boolean;
  offlineApplyResults?: AppliedInventoryResult[];
}

export function ChatWorkspace({
  profile,
  inventory,
  recentTransactions,
  messages,
  recipes,
  onGenerateAndOpenRecipe,
  onOpenRecipeById,
  onGoToKitchen,
}: ChatWorkspaceProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [failedTurn, setFailedTurn] = useState<FailedTurnState | null>(null);
  const [activeBudget, setActiveBudget] = useState<number | null>(null);
  const [customBudgetInput, setCustomBudgetInput] = useState('');
  const [generatingDishKey, setGeneratingDishKey] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [transferredItems, setTransferredItems] = useState<Record<string, boolean>>({});
  const [transferringKey, setTransferringKey] = useState<string | null>(null);

  const CLEAR_COMMAND_REGEX = /^\/\*?clear$/i;
  const CLEAR_CONFIRMATION_TEXT =
    'Chat saaf kar diya bhai! Baaki sab yaad hai. Tera kitchen, teri preferences aur purani food history safe hai.';

  const bottomRef = useRef<HTMLDivElement>(null);
  const buddyName = profile.buddyName || 'KhanaBanana';
  const conversationState: ConversationState = profile.conversationState || 'IDLE';
  const discoveryContext = profile.discoveryContext || {};
  const availableItems = inventory.filter(
    (i) => i.isAvailable && (i.numericQuantity === undefined || i.numericQuantity > 0),
  );
  const availableCount = availableItems.length;

  useEffect(() => {
    if (discoveryContext.activeBudget !== undefined) {
      setActiveBudget(discoveryContext.activeBudget);
    } else if (
      profile.hasExplicitDefaultBudget &&
      profile.defaultBudget !== null &&
      profile.defaultBudget !== undefined
    ) {
      setActiveBudget(profile.defaultBudget);
    } else {
      setActiveBudget(null);
    }
  }, [discoveryContext.activeBudget, profile.hasExplicitDefaultBudget, profile.defaultBudget]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending, failedTurn]);

  const starterPrompts =
    availableCount === 0
      ? [
          '100g onion le aaya.',
          '500g aloo bhi le aaya.',
          'Aaj kya khayein?',
          '2 packet Maggi le aaya.',
        ]
      : [
          'Aaj kya khayein?',
          '100g onion le aaya.',
          'Kuch spicy khane ka mann hai.',
          'Doodh khatam ho gaya.',
        ];

  function formatStateLabel(state: ConversationState): string {
    switch (state) {
      case 'FOOD_DISCOVERY':
        return 'Mood discovery';
      case 'DISH_DISCOVERY':
        return 'Choose a dish';
      case 'RECIPE_SELECTED':
      case 'RECIPE_GENERATION':
        return 'Preparing recipe';
      case 'COOKING_MODE':
        return 'Cooking mode';
      case 'INVENTORY_UPDATE':
        return 'Kitchen synced';
      default:
        return 'Ready';
    }
  }

  async function executeAiTurn(params: {
    userText: string;
    historySnapshot: ChatMessage[];
    skipInventoryMutations?: boolean;
    userMessageId: string;
  }) {
    setSending(true);
    setFailedTurn(null);

    try {
      const aiRes = await sendChatMessageToAi({
        message: params.userText,
        history: params.historySnapshot,
        profile,
        inventory,
        recentTransactions,
        activeBudgetOverride: activeBudget,
        conversationState,
        discoveryContext,
      });

      if (
        (aiRes.detectedMealsEatenRecently && aiRes.detectedMealsEatenRecently.length > 0) ||
        aiRes.detectedPreferenceUpdates
      ) {
        await applyPersistentMemoryUpdates(
          profile.uid,
          profile,
          aiRes.detectedPreferenceUpdates,
          aiRes.detectedMealsEatenRecently || [],
        );
      }

      // Execute detected inventory actions atomically via Firestore BEFORE confirming in chat
      let inventoryResults: AppliedInventoryResult[] = [];
      let nextInventorySnapshot: InventoryItem[] = [...inventory];
      if (!params.skipInventoryMutations && aiRes.inventoryActions?.length > 0) {
        for (const act of aiRes.inventoryActions) {
          if (act.action === 'NO_INVENTORY_ACTION' || act.action === 'QUERY_INVENTORY') {
            continue;
          }
          const applied = await applyInventoryActionTransaction(profile.uid, act, 'chat');
          if (applied.status !== 'skipped') {
            inventoryResults.push(applied);
          }
          if (applied.status === 'applied') {
            const meta = normalizeIngredientMeta(act.canonicalName || act.ingredient, act.category);
            const qtyNum = Number(act.quantity || 1);
            const unitStr = act.unit || meta.defaultUnit;
            const existingIdx = nextInventorySnapshot.findIndex(
              (item) => (item.canonicalName || normalizeIngredientMeta(item.name).canonicalName) === meta.canonicalName,
            );
            if (act.action === 'MARK_UNAVAILABLE') {
              if (existingIdx >= 0) {
                nextInventorySnapshot[existingIdx] = {
                  ...nextInventorySnapshot[existingIdx],
                  isAvailable: false,
                  numericQuantity: 0,
                  quantity: `0 ${unitStr}`,
                };
              }
            } else if (act.action === 'ADD_INGREDIENT' || act.action === 'RESTOCK_INGREDIENT') {
              if (existingIdx >= 0) {
                nextInventorySnapshot[existingIdx] = {
                  ...nextInventorySnapshot[existingIdx],
                  isAvailable: true,
                  numericQuantity: Math.max(nextInventorySnapshot[existingIdx].numericQuantity || 0, qtyNum),
                  unit: unitStr,
                  quantity: applied.newQtyText || `${qtyNum} ${unitStr}`,
                };
              } else {
                nextInventorySnapshot.push({
                  id: `temp_${meta.canonicalName}`,
                  userId: profile.uid,
                  canonicalName: meta.canonicalName,
                  displayName: meta.displayName,
                  name: meta.displayName,
                  numericQuantity: qtyNum,
                  unit: unitStr,
                  quantity: applied.newQtyText || `${qtyNum} ${unitStr}`,
                  category: meta.category,
                  isRegular: true,
                  isAvailable: true,
                });
              }
            }
          }
        }
      } else if (failedTurn?.offlineApplyResults?.length) {
        inventoryResults = failedTurn.offlineApplyResults;
      }

      // Guard: if any Firestore update failed, never let reply falsely claim success
      const failedUpdates = inventoryResults.filter((r) => r.status === 'failed');
      let finalReply = aiRes.reply;
      if (failedUpdates.length > 0) {
        const failedNames = failedUpdates.map((f) => f.displayName).join(', ');
        finalReply = `${aiRes.reply}\n\nNote: ${failedNames} could not be saved to Firestore right now. Please try updating in My Kitchen or retry.`;
      }

      const nextCtx = aiRes.updatedDiscoveryContext || discoveryContext;
      if (nextCtx.activeBudget !== undefined) {
        setActiveBudget(nextCtx.activeBudget);
      }

      await updateConversationContext(
        profile.uid,
        aiRes.nextConversationState || 'IDLE',
        nextCtx,
      );

      const isDishMode = aiRes.intentMode === 'DISH_DISCOVERY';
      const assistantMsgId = await addChatMessage(profile.uid, {
        role: 'assistant',
        content: finalReply,
        buddyNameSnapshot: buddyName,
        responseMode: aiRes.intentMode,
        ...(aiRes.selectedDishName ? { selectedDishName: aiRes.selectedDishName } : {}),
        ...(aiRes.includeBudgetPlan && aiRes.budgetPlan
          ? {
              budgetLimit: aiRes.budgetPlan.budgetLimit,
              shoppingSummary: aiRes.budgetPlan,
            }
          : {}),
        ...(isDishMode && aiRes.suggestedDishes?.length
          ? { suggestedDishes: aiRes.suggestedDishes.slice(0, 3) }
          : {}),
        ...(inventoryResults.length > 0 ? { inventoryResults } : {}),
      });

      // Mode D: If user selected a dish in chat (e.g. "Pehla wala banate hain"), generate ONLY that recipe
      if (aiRes.intentMode === 'RECIPE_SELECTED' && aiRes.selectedDishName) {
        const candidatePool =
          nextCtx.lastSuggestedDishes?.length
            ? nextCtx.lastSuggestedDishes
            : discoveryContext.lastSuggestedDishes || [];
        const matchedDish =
          candidatePool.find(
            (d) => d.dishName.toLowerCase() === aiRes.selectedDishName!.toLowerCase(),
          ) || {
            dishName: aiRes.selectedDishName,
            cuisine: 'Indian',
            shortPitch: 'Selected from chat options',
            prepCookTime: '25 mins',
            estimatedExtraCostInr: nextCtx.activeBudget ?? 0,
            matchReason: 'User selected this dish',
            imageCategory: 'kitchen' as const,
          };

        await triggerRecipeGeneration(
          matchedDish,
          assistantMsgId,
          finalReply,
          nextCtx.activeBudget !== undefined ? nextCtx.activeBudget : activeBudget,
          nextInventorySnapshot,
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Your food buddy is temporarily busy. Tap Retry to try again.';
      const cleanMsg = msg.trim().startsWith('{')
        ? 'Your food buddy is temporarily busy due to high demand. Tap Retry in a moment!'
        : msg;

      setFailedTurn({
        userMessageText: params.userText,
        userMessageId: params.userMessageId,
        errorMessage: cleanMsg,
        retryable: true,
        offlineInventoryApplied: Boolean(params.skipInventoryMutations),
      });
    } finally {
      setSending(false);
    }
  }

  async function handleSendText(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed || sending || clearing) return;

    // Intercept /*clear and /clear BEFORE logging as a message or calling Gemini
    if (CLEAR_COMMAND_REGEX.test(trimmed)) {
      setInput('');
      await handleClearCurrentChatOnly();
      return;
    }

    setInput('');
    setClearNotice(null);
    setFailedTurn(null);
    setSending(true);

    const historyBefore = [...messages];
    let userMsgId = '';

    try {
      userMsgId = await addChatMessage(profile.uid, {
        role: 'user',
        content: trimmed,
        buddyNameSnapshot: buddyName,
      });
    } catch (err) {
      setSending(false);
      setFailedTurn({
        userMessageText: trimmed,
        userMessageId: '',
        errorMessage: err instanceof Error ? err.message : 'Failed to save message.',
        retryable: true,
        offlineInventoryApplied: false,
      });
      return;
    }

    await executeAiTurn({
      userText: trimmed,
      historySnapshot: historyBefore,
      skipInventoryMutations: false,
      userMessageId: userMsgId,
    });
  }

  async function handleRetryFailedTurn() {
    if (!failedTurn || sending) return;

    // Never duplicate the user message in Firestore if userMessageId already exists
    if (!failedTurn.userMessageId) {
      await handleSendText(failedTurn.userMessageText);
      return;
    }

    const historyWithoutLastUser = messages.filter((m) => m.id !== failedTurn.userMessageId);
    await executeAiTurn({
      userText: failedTurn.userMessageText,
      historySnapshot: historyWithoutLastUser,
      skipInventoryMutations: failedTurn.offlineInventoryApplied,
      userMessageId: failedTurn.userMessageId,
    });
  }

  async function handleOfflineInventorySync() {
    if (!failedTurn || failedTurn.offlineInventoryApplied) return;
    const parsedActions = parseOfflineInventoryCommand(failedTurn.userMessageText);
    if (parsedActions.length === 0) return;

    const results: AppliedInventoryResult[] = [];
    for (const act of parsedActions) {
      const res = await applyInventoryActionTransaction(
        profile.uid,
        act,
        'chat',
        `Direct kitchen sync while AI busy: "${failedTurn.userMessageText}"`,
      );
      results.push(res);
    }

    setFailedTurn({
      ...failedTurn,
      offlineInventoryApplied: true,
      offlineApplyResults: results,
    });
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    handleSendText(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText(input);
    }
  }

  async function triggerRecipeGeneration(
    dish: SuggestedDish,
    messageId: string,
    contextSummary: string,
    budgetLimit: number | null,
    inventoryOverride?: InventoryItem[],
  ) {
    const key = `${messageId}_${dish.dishName}`;
    setGeneratingDishKey(key);
    setFailedTurn(null);
    try {
      const recipeId = await onGenerateAndOpenRecipe(
        dish,
        contextSummary,
        budgetLimit,
        messageId,
        inventoryOverride,
      );
      if (recipeId) {
        await attachRecipeToMessage(profile.uid, messageId, recipeId);
      }
    } catch (err) {
      const msgText = err instanceof Error ? err.message : 'Failed to generate full recipe.';
      setFailedTurn({
        userMessageText: '',
        userMessageId: 'recipe_gen_error',
        errorMessage: msgText,
        retryable: false,
        offlineInventoryApplied: true,
      });
    } finally {
      setGeneratingDishKey(null);
    }
  }

  async function handleSelectDish(dish: SuggestedDish, msg: ChatMessage) {
    await triggerRecipeGeneration(
      dish,
      msg.id,
      msg.content,
      msg.shoppingSummary?.budgetLimit ?? discoveryContext.activeBudget ?? activeBudget,
    );
  }

  async function handleTransferShoppingItem(msgId: string, item: ShoppingListItem) {
    const key = `${msgId}_${item.name}`;
    if (transferredItems[key] || transferringKey) return;
    setTransferringKey(key);
    try {
      const meta = normalizeIngredientMeta(item.name);
      const parsed = parseQuantityString(item.quantity, meta.defaultUnit);
      const res = await applyInventoryActionTransaction(
        profile.uid,
        {
          action: 'ADD_INGREDIENT',
          ingredient: item.name,
          canonicalName: meta.canonicalName,
          quantity: parsed.numericQuantity,
          unit: parsed.unit,
          category: meta.category,
          confidence: 1,
          isPurchase: true,
        },
        'shopping_transfer',
        `Bought from shopping list: ${item.quantity} ${item.name}`,
      );
      if (res.status === 'applied') {
        setTransferredItems((prev) => ({ ...prev, [key]: true }));
      }
    } finally {
      setTransferringKey(null);
    }
  }

  async function handleTransferAllShopping(msgId: string, items: ShoppingListItem[]) {
    for (const item of items) {
      const key = `${msgId}_${item.name}`;
      if (!transferredItems[key]) {
        await handleTransferShoppingItem(msgId, item);
      }
    }
  }

  async function handleClearCurrentChatOnly() {
    if (clearing) return;
    setClearing(true);
    try {
      await clearChatHistory(
        profile.uid,
        messages.map((m) => m.id),
      );
      await updateConversationContext(profile.uid, 'IDLE', {});
      setActiveBudget(
        profile.hasExplicitDefaultBudget && profile.defaultBudget !== null
          ? profile.defaultBudget
          : null,
      );
      setFailedTurn(null);
      setClearNotice(CLEAR_CONFIRMATION_TEXT);
    } finally {
      setClearing(false);
    }
  }

  async function handleClearChat() {
    if (messages.length === 0 || clearing) return;
    await handleClearCurrentChatOnly();
  }

  async function handleBudgetSelect(val: number | null) {
    setActiveBudget(val);
    await updateConversationContext(profile.uid, conversationState, {
      ...discoveryContext,
      activeBudget: val,
    });
  }

  async function applyCustomBudget() {
    const num = Number(customBudgetInput);
    if (!Number.isNaN(num) && num >= 0 && num <= 10000) {
      const rounded = Math.round(num);
      setCustomBudgetInput('');
      await handleBudgetSelect(rounded);
    }
  }

  const offlineCandidates = failedTurn?.userMessageText
    ? parseOfflineInventoryCommand(failedTurn.userMessageText)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-4.25rem)] max-w-5xl mx-auto w-full">
      {/* Companion Header & Budget Control Bar */}
      <div className="bg-white border border-[#E6E0D3] rounded-2xl p-4 sm:px-6 mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <img
            src={MEDIA_ASSETS.buddyAvatar}
            alt={buddyName}
            referrerPolicy="no-referrer"
            className="w-11 h-11 rounded-xl object-cover border border-[#E6E0D3] bg-[#FAF8F3] shrink-0"
          />
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-[#1A2421] truncate">
              {buddyName}
            </h1>
            <p className="text-xs text-[#576560] truncate">
              <button
                type="button"
                onClick={onGoToKitchen}
                className="hover:underline text-[#1B4D3E] font-semibold cursor-pointer"
              >
                {availableCount === 0
                  ? 'Empty kitchen · View My Kitchen'
                  : `${availableCount} in My Kitchen`}
              </button>
              {' · '}
              {formatStateLabel(conversationState)}
              {' · '}
              {profile.defaultEquipment}
            </p>
          </div>
        </div>

        {/* Budget Limit Segmented Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3EFE6] rounded-xl">
            {[
              { label: 'No budget limit', value: null },
              { label: 'No shopping (₹0)', value: 0 },
              { label: '₹50', value: 50 },
              { label: '₹100', value: 100 },
            ].map((opt) => {
              const active = activeBudget === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleBudgetSelect(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#1B4D3E] text-white'
                      : 'text-[#576560] hover:text-[#1A2421]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <div className="relative w-24">
              <IndianRupee className="w-3 h-3 text-[#576560] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="number"
                min={0}
                max={10000}
                value={customBudgetInput}
                onChange={(e) => setCustomBudgetInput(e.target.value)}
                placeholder="Custom ₹"
                aria-label="Custom budget in rupees"
                className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] text-xs font-mono tabular-nums text-[#1A2421] placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-[#1B4D3E]"
              />
            </div>
            {customBudgetInput && (
              <button
                type="button"
                onClick={applyCustomBudget}
                className="px-2.5 py-1.5 rounded-lg bg-[#F4C430] text-[#13382D] text-xs font-bold cursor-pointer"
              >
                Set
              </button>
            )}
          </div>

          {activeBudget !== null && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1B4D3E]/10 text-[#1B4D3E] text-xs font-semibold whitespace-nowrap">
              {activeBudget === 0 ? 'Active: No shopping (₹0)' : `Active budget: ₹${activeBudget}`}
              <button
                type="button"
                onClick={() => handleBudgetSelect(null)}
                aria-label="Clear active budget"
                className="hover:text-[#13382D] cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearChat}
              disabled={clearing}
              title="Clear conversation"
              className="p-2 rounded-xl border border-[#E6E0D3] text-[#576560] hover:text-[#E06D2B] hover:bg-[#F3EFE6] transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Conversation Area */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1 pb-4">
        {clearNotice && messages.length === 0 && (
          <div
            role="status"
            className="bg-[#1B4D3E]/10 border border-[#1B4D3E]/30 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 text-sm text-[#13382D]"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#1B4D3E] shrink-0" />
              <span className="font-medium">{clearNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setClearNotice(null)}
              aria-label="Dismiss notice"
              className="text-[#1B4D3E] hover:text-[#13382D] p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-10">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5 mb-6">
              <img
                src={MEDIA_ASSETS.buddyAvatar}
                alt={buddyName}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-2xl object-cover border border-[#E6E0D3] bg-[#FAF8F3] shrink-0"
              />
              <div>
                <p className="text-xs font-medium text-[#E06D2B] mb-1">
                  Khana kya hai? Woh hum decide karenge.
                </p>
                <h2 className="font-display text-2xl font-bold text-[#1A2421]">
                  Namaste {profile.displayName}! Main tera {buddyName}. Aaj kya pakana hai?
                </h2>
                <p className="text-sm text-[#576560] mt-1.5">
                  {availableCount === 0
                    ? 'Tera kitchen abhi bilkul khali hai! Chat mein bata kya kharida (jaise "500g aloo laya") ya My Kitchen mein jaake basic staples add kar le.'
                    : 'Tell me what you bought, what you used, your mood, or your ₹ budget. I manage your kitchen automatically!'}
                </p>
              </div>
            </div>

            {availableCount === 0 && (
              <div className="mb-5 p-4 rounded-xl bg-[#F4C430]/15 border border-[#F4C430]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs sm:text-sm text-[#1A2421]">
                  <strong>Empty Kitchen:</strong> Add your real ingredients first so {buddyName} doesn't guess phantom stock.
                </p>
                <button
                  type="button"
                  onClick={onGoToKitchen}
                  className="px-4 py-2 rounded-xl bg-[#1B4D3E] text-white text-xs font-semibold hover:bg-[#13382D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open My Kitchen
                </button>
              </div>
            )}

            <div className="border-t border-[#E6E0D3] pt-5">
              <p className="text-xs font-semibold text-[#576560] mb-3">
                Try saying to {buddyName}:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleSendText(prompt)}
                    className="text-left p-4 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] hover:border-[#1B4D3E]/40 text-sm text-[#1A2421] transition-colors flex items-start justify-between gap-3 cursor-pointer"
                  >
                    <span>"{prompt}"</span>
                    <ArrowRight className="w-4 h-4 text-[#1B4D3E] shrink-0 mt-0.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, msgIdx) => {
            const isUser = msg.role === 'user';
            const attachedRecipe = msg.attachedRecipeId
              ? recipes.find((r) => r.id === msg.attachedRecipeId)
              : undefined;
            const isInventoryOnlyBubble =
              !isUser &&
              (msg.responseMode === 'INVENTORY_UPDATE' ||
                (Boolean(msg.inventoryResults?.length) &&
                  !msg.suggestedDishes?.length &&
                  !msg.shoppingSummary &&
                  !msg.attachedRecipeId &&
                  msg.responseMode !== 'RECIPE_SELECTED'));
            const isLatestMessage = msgIdx === messages.length - 1;

            return (
              <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-3xl w-full ${isUser ? 'flex justify-end' : 'space-y-3'}`}>
                  {isUser ? (
                    <div className="max-w-xl bg-[#1B4D3E] text-white rounded-2xl rounded-tr-sm px-5 py-3 text-[15px] leading-relaxed">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.budgetLimit !== undefined && (
                        <p className="text-xs text-[#F4C430] mt-1 font-mono tabular-nums">
                          Budget cap: ₹{msg.budgetLimit}
                        </p>
                      )}
                    </div>
                  ) : isInventoryOnlyBubble ? (
                    /* Compact Inventory Confirmation Bubble */
                    <div className="bg-white border border-[#E6E0D3] rounded-2xl rounded-tl-sm px-5 py-3.5 max-w-xl space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-display text-xs font-bold text-[#1B4D3E]">
                          {buddyName}
                        </span>
                        <button
                          type="button"
                          onClick={onGoToKitchen}
                          className="text-xs font-semibold text-[#1B4D3E] hover:underline whitespace-nowrap cursor-pointer"
                        >
                          View My Kitchen
                        </button>
                      </div>
                      <p className="text-[15px] text-[#1A2421] leading-snug">{msg.content}</p>
                      {msg.inventoryResults && msg.inventoryResults.length > 0 && (
                        <div className="pt-1.5 border-t border-[#E6E0D3]/70 space-y-1">
                          {msg.inventoryResults.map((res, i) => (
                            <div
                              key={i}
                              className={`flex items-center gap-1.5 text-xs ${
                                res.status === 'failed'
                                  ? 'text-[#9A3412]'
                                  : res.status === 'needs_clarification'
                                    ? 'text-[#E06D2B]'
                                    : 'text-[#576560]'
                              }`}
                            >
                              {res.status === 'applied' && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#1B4D3E] shrink-0" />
                              )}
                              {res.status === 'failed' && (
                                <AlertCircle className="w-3.5 h-3.5 text-[#9A3412] shrink-0" />
                              )}
                              <span>{res.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Ordinary Discovery / Dish Selection / Recipe Handoff Bubble */
                    <div className="bg-white border border-[#E6E0D3] rounded-2xl rounded-tl-sm p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={MEDIA_ASSETS.buddyAvatar}
                            alt={buddyName}
                            referrerPolicy="no-referrer"
                            className="w-7 h-7 rounded-lg object-cover border border-[#E6E0D3] bg-[#FAF8F3]"
                          />
                          <span className="font-display text-sm font-bold text-[#1B4D3E]">
                            {buddyName}
                          </span>
                          {msg.buddyNameSnapshot && msg.buddyNameSnapshot !== buddyName && (
                            <span className="text-xs text-[#576560]">
                              · previously {msg.buddyNameSnapshot}
                            </span>
                          )}
                        </div>
                        {availableCount === 0 && (
                          <button
                            type="button"
                            onClick={onGoToKitchen}
                            className="text-xs font-semibold text-[#1B4D3E] hover:underline whitespace-nowrap cursor-pointer"
                          >
                            View My Kitchen
                          </button>
                        )}
                      </div>

                      <div className="text-[15px] text-[#1A2421] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>

                      {msg.inventoryResults && msg.inventoryResults.length > 0 && (
                        <div className="pt-2 border-t border-[#E6E0D3]/70 space-y-1">
                          {msg.inventoryResults.map((res, i) => (
                            <div
                              key={i}
                              className={`flex items-center gap-1.5 text-xs ${
                                res.status === 'failed'
                                  ? 'text-[#9A3412]'
                                  : res.status === 'needs_clarification'
                                    ? 'text-[#E06D2B]'
                                    : 'text-[#1B4D3E]'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>{res.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Optional Contextual Shopping Breakdown (only if explicitly requested) */}
                      {msg.shoppingSummary && (
                        <div className="pt-4 border-t border-[#E6E0D3] space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-[#1A2421]">
                              <ShoppingBasket className="w-4 h-4 text-[#E06D2B]" />
                              <span>Shopping Breakdown</span>
                            </div>
                            <div className="text-xs font-mono tabular-nums text-[#1B4D3E] font-semibold">
                              Est. ₹{msg.shoppingSummary.totalEstimatedCost} / Limit ₹
                              {msg.shoppingSummary.budgetLimit}
                            </div>
                          </div>

                          {msg.shoppingSummary.itemsToBuy?.length > 0 ? (
                            <div className="space-y-2">
                              <div className="divide-y divide-[#E6E0D3] border border-[#E6E0D3] rounded-xl px-4 bg-[#FAF8F3]">
                                {msg.shoppingSummary.itemsToBuy.map((item, idx) => {
                                  const tKey = `${msg.id}_${item.name}`;
                                  const isAdded = Boolean(transferredItems[tKey]);
                                  const isBusy = transferringKey === tKey;
                                  return (
                                    <div
                                      key={idx}
                                      className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm"
                                    >
                                      <div className="min-w-0">
                                        <span className="font-medium text-[#1A2421]">
                                          {item.name}
                                        </span>
                                        <span className="text-[#576560] ml-2">
                                          {item.quantity} ·{' '}
                                          {item.isEssential ? 'Essential' : 'Optional'}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-2.5 shrink-0">
                                        <span className="font-mono tabular-nums font-semibold text-[#1B4D3E]">
                                          {item.estimatedPriceRange}
                                        </span>
                                        <button
                                          type="button"
                                          disabled={isAdded || Boolean(transferringKey)}
                                          onClick={() => handleTransferShoppingItem(msg.id, item)}
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                                            isAdded
                                              ? 'bg-[#1B4D3E]/10 text-[#1B4D3E]'
                                              : 'bg-white border border-[#E6E0D3] hover:bg-[#F3EFE6] text-[#1A2421]'
                                          }`}
                                        >
                                          {isBusy ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : isAdded ? (
                                            <>
                                              <Check className="w-3 h-3" />
                                              In Kitchen
                                            </>
                                          ) : (
                                            '+ Bought'
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  disabled={Boolean(transferringKey)}
                                  onClick={() =>
                                    handleTransferAllShopping(
                                      msg.id,
                                      msg.shoppingSummary!.itemsToBuy,
                                    )
                                  }
                                  className="text-xs font-semibold text-[#1B4D3E] hover:underline cursor-pointer"
                                >
                                  Transfer all to My Kitchen →
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs font-medium text-[#1B4D3E]">
                              ₹0 shopping required — cooking 100% from available kitchen items.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Mode C: Curated 2-3 Compact Dish Selection Cards */}
                      {msg.suggestedDishes && msg.suggestedDishes.length > 0 && (
                        <div className="pt-4 border-t border-[#E6E0D3] space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {msg.suggestedDishes.map((dish, idx) => {
                              const loadingThis = generatingDishKey === `${msg.id}_${dish.dishName}`;
                              const outlay = dish.actualShoppingOutlayInr ?? dish.estimatedExtraCostInr;
                              const usesExisting =
                                dish.usesExistingOnly !== undefined
                                  ? dish.usesExistingOnly
                                  : outlay === 0;
                              const availableList = dish.availableIngredients || [];
                              const missingList = dish.missingIngredients || [];
                              const overBudget = dish.fitsActiveBudget === false;
                              return (
                                <div
                                  key={idx}
                                  className="border border-[#E6E0D3] rounded-xl overflow-hidden bg-[#FAF8F3] flex flex-col justify-between"
                                >
                                  <div>
                                    <div className="h-24 w-full overflow-hidden bg-[#E6E0D3]">
                                      <SafeImage
                                        src={getDishImage(dish.imageCategory)}
                                        alt={dish.dishName}
                                        className="w-full h-full object-cover"
                                        fallbackTitle={dish.dishName}
                                      />
                                    </div>
                                    <div className="p-3.5 space-y-2">
                                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                                        <span className="text-[#576560]">
                                          Option {idx + 1} · {dish.prepCookTime}
                                        </span>
                                        <span
                                          className={`font-bold ${
                                            outlay === 0
                                              ? 'text-[#1B4D3E]'
                                              : overBudget
                                                ? 'text-[#9A3412]'
                                                : 'text-[#E06D2B]'
                                          }`}
                                        >
                                          {outlay === 0 ? '₹0 extra' : `~₹${outlay} to buy`}
                                        </span>
                                      </div>
                                      <h4 className="font-display font-bold text-sm text-[#1A2421]">
                                        {dish.dishName}
                                      </h4>
                                      <p className="text-xs text-[#576560] line-clamp-2">
                                        {dish.shortPitch}
                                      </p>

                                      {availableList.length > 0 && (
                                        <div className="text-[11px] text-[#1B4D3E] leading-snug">
                                          <span className="font-semibold">Available:</span>{' '}
                                          {availableList
                                            .slice(0, 3)
                                            .map((a) => a.split('(')[0].trim())
                                            .join(', ')}
                                          {availableList.length > 3
                                            ? ` +${availableList.length - 3} more`
                                            : ''}
                                        </div>
                                      )}

                                      {missingList.length > 0 ? (
                                        <div className="text-[11px] text-[#576560] leading-snug">
                                          <span className="font-semibold text-[#E06D2B]">Need:</span>{' '}
                                          {missingList
                                            .slice(0, 3)
                                            .map((m) => `${m.name} (${m.estimatedPriceRange})`)
                                            .join(', ')}
                                          {missingList.length > 3
                                            ? ` +${missingList.length - 3} more`
                                            : ''}
                                        </div>
                                      ) : (
                                        <p className="text-[11px] font-medium text-[#1B4D3E]">
                                          {usesExisting
                                            ? '100% cookable from existing kitchen stock'
                                            : dish.matchReason}
                                        </p>
                                      )}

                                      {activeBudget !== null && (
                                        <p
                                          className={`text-[11px] font-semibold ${
                                            overBudget ? 'text-[#9A3412]' : 'text-[#1B4D3E]'
                                          }`}
                                        >
                                          {overBudget
                                            ? `Over ₹${activeBudget} budget`
                                            : `Fits ₹${activeBudget} budget`}
                                        </p>
                                      )}

                                      {dish.substitutionsNote && (
                                        <p className="text-[10px] text-[#576560] italic">
                                          {dish.substitutionsNote}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-3.5 pb-3.5">
                                    <button
                                      type="button"
                                      disabled={Boolean(generatingDishKey)}
                                      onClick={() => handleSelectDish(dish, msg)}
                                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1B4D3E] hover:bg-[#13382D] text-white text-xs font-semibold disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                                    >
                                      {loadingThis ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          Preparing Recipe...
                                        </>
                                      ) : (
                                        <>
                                          <Utensils className="w-3.5 h-3.5" />
                                          Select Dish
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Mode C Selection Interaction Bar */}
                          {isLatestMessage && !attachedRecipe && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={sending || Boolean(generatingDishKey)}
                                onClick={() => handleSendText('Nahi, kuch aur bata.')}
                                className="px-3 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] whitespace-nowrap cursor-pointer"
                              >
                                More options
                              </button>
                              <button
                                type="button"
                                disabled={sending || Boolean(generatingDishKey)}
                                onClick={() =>
                                  handleSendText('Mood change hai, kuch aur taste try karte hain.')
                                }
                                className="px-3 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] whitespace-nowrap cursor-pointer"
                              >
                                Change craving
                              </button>
                              <button
                                type="button"
                                disabled={sending || Boolean(generatingDishKey)}
                                onClick={() =>
                                  handleSendText('Budget ₹0 kar de, sirf ghar ke saman se bata.')
                                }
                                className="px-3 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1B4D3E] whitespace-nowrap cursor-pointer"
                              >
                                Cheaper / ₹0
                              </button>
                              <button
                                type="button"
                                disabled={sending || Boolean(generatingDishKey)}
                                onClick={() =>
                                  handleSendText('Ye sab rehne de, naye sire se sochte hain.')
                                }
                                className="px-3 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#576560] whitespace-nowrap cursor-pointer"
                              >
                                Reject all
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {attachedRecipe && (
                        <div className="pt-3 border-t border-[#E6E0D3] flex items-center justify-between gap-3">
                          <span className="text-xs text-[#576560]">
                            Recipe ready:{' '}
                            <strong className="text-[#1A2421]">{attachedRecipe.dishName}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenRecipeById(attachedRecipe.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F4C430] text-[#13382D] text-xs font-bold whitespace-nowrap cursor-pointer"
                          >
                            <ChefHat className="w-3.5 h-3.5" />
                            Open Recipe
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-white border border-[#E6E0D3] rounded-2xl px-5 py-4 flex items-center gap-3 text-sm text-[#576560]">
              <Loader2 className="w-4 h-4 animate-spin text-[#1B4D3E]" />
              <span>{buddyName} is checking your kitchen & preparing a response...</span>
            </div>
          </div>
        )}

        {/* Friendly Error + Idempotent Retry + Offline Inventory Preservation */}
        {failedTurn && (
          <div
            role="alert"
            className="bg-white border border-[#E06D2B]/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#E06D2B] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#1A2421]">{failedTurn.errorMessage}</p>
                {failedTurn.offlineInventoryApplied && failedTurn.offlineApplyResults && (
                  <p className="text-xs text-[#1B4D3E] font-medium">
                    Saved directly to My Kitchen:{' '}
                    {failedTurn.offlineApplyResults.map((r) => r.message).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {offlineCandidates.length > 0 && !failedTurn.offlineInventoryApplied && (
                <button
                  type="button"
                  onClick={handleOfflineInventorySync}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#1B4D3E]/30 bg-[#1B4D3E]/10 hover:bg-[#1B4D3E]/15 text-[#1B4D3E] text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  Save to My Kitchen Now
                </button>
              )}

              {failedTurn.retryable && (
                <button
                  type="button"
                  onClick={handleRetryFailedTurn}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Chat Composer */}
      <form
        onSubmit={handleFormSubmit}
        className="bg-white border border-[#E6E0D3] rounded-2xl p-3 flex items-end gap-3 shrink-0"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Talk to ${buddyName}... ("500g aloo laya", "Aaj kya khayein?", or /*clear)`}
          className="flex-1 resize-none px-3 py-2 bg-transparent text-sm sm:text-[15px] text-[#1A2421] placeholder:text-[#576560]/70 focus:outline-none max-h-32"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  );
}
