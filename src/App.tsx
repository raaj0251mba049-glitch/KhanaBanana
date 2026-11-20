import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  BookOpen,
  Loader2,
  LogOut,
  MessageSquare,
  Refrigerator,
  SlidersHorizontal,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CookingModeView } from './components/CookingModeView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MyKitchenView } from './components/MyKitchenView';
import { MyRecipesView } from './components/MyRecipesView';
import { PreferencesView } from './components/PreferencesView';
import { RecipeDetailModal } from './components/RecipeDetailModal';
import { auth } from './lib/firebase';
import { normalizeIngredientMeta } from './lib/inventoryUtils';
import { calculateRecipeCostBreakdown, scaleRecipeWithCost } from './lib/recipeCostEngine';
import { generateFullRecipe } from './services/aiService';
import {
  addChatMessage,
  applyInventoryActionTransaction,
  ensureUserProfile,
  saveGeneratedRecipe,
  subscribeInventory,
  subscribeInventoryTransactions,
  subscribeMessages,
  subscribeRecipes,
  subscribeUserProfile,
  toggleRecipeSaved,
  updateConversationContext,
  updateRecentMeals,
  updateSavedRecipeBreakdown,
} from './services/firestoreService';
import type {
  AppliedInventoryResult,
  AppView,
  ChatMessage,
  InventoryItem,
  InventoryTransaction,
  SavedRecipe,
  SuggestedDish,
  UserProfile,
} from './types';

function MainApp() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [selectedRecipe, setSelectedRecipe] = useState<SavedRecipe | null>(null);
  const [cookingRecipe, setCookingRecipe] = useState<SavedRecipe | null>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          await ensureUserProfile(firebaseUser);
        } catch (err) {
          console.error('Failed ensuring user profile:', err);
        }
      } else {
        setProfile(null);
        setInventory([]);
        setTransactions([]);
        setMessages([]);
        setRecipes([]);
        setSelectedRecipe(null);
        setCookingRecipe(null);
        setActiveView('chat');
      }
      setAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubProfile = subscribeUserProfile(user.uid, setProfile);
    const unsubInventory = subscribeInventory(user.uid, setInventory);
    const unsubTx = subscribeInventoryTransactions(user.uid, setTransactions);
    const unsubMessages = subscribeMessages(user.uid, setMessages);
    const unsubRecipes = subscribeRecipes(user.uid, setRecipes);
    return () => {
      unsubProfile();
      unsubInventory();
      unsubTx();
      unsubMessages();
      unsubRecipes();
    };
  }, [user]);

  async function handleGenerateAndOpenRecipe(
    dish: SuggestedDish,
    contextSummary: string,
    budgetLimit: number | null,
    _messageId?: string,
    inventoryOverride?: InventoryItem[],
  ): Promise<string | undefined> {
    if (!profile) return undefined;
    const effectiveInv = inventoryOverride || inventory;
    await updateConversationContext(profile.uid, 'RECIPE_GENERATION', {
      ...(profile.discoveryContext || {}),
      selectedDishName: dish.dishName,
    });
    const generated = await generateFullRecipe({
      dishName: dish.dishName,
      profile,
      inventory: effectiveInv,
      conversationContext: contextSummary,
      budgetOverride: budgetLimit,
      selectedDishBlueprint: dish,
    });
    const saved = await saveGeneratedRecipe(profile.uid, {
      ...generated,
      isSaved: true,
    });
    await updateConversationContext(profile.uid, 'RECIPE_SELECTED', {
      ...(profile.discoveryContext || {}),
      selectedDishName: saved.dishName,
    });
    setSelectedRecipe(saved);
    return saved.id;
  }

  async function handleRegenerateForServings(recipe: SavedRecipe, newServings: number) {
    if (!profile) return;
    const currentBudget =
      profile.discoveryContext?.activeBudget !== undefined
        ? profile.discoveryContext.activeBudget
        : profile.hasExplicitDefaultBudget
          ? (profile.defaultBudget ?? null)
          : null;

    const scaledBreakdown = scaleRecipeWithCost(
      recipe.exactIngredients,
      recipe.servings || 2,
      newServings,
      inventory,
      currentBudget,
    );

    const generated = await generateFullRecipe({
      dishName: recipe.dishName,
      profile,
      inventory,
      servingsOverride: newServings,
      equipmentOverride: recipe.applianceType === 'Induction' ? 'Induction' : profile.defaultEquipment,
      utensilsOverride: recipe.requiredUtensils.join(', '),
      budgetOverride: currentBudget,
      lockedIngredients: scaledBreakdown.requiredIngredients,
    });
    const saved = await saveGeneratedRecipe(profile.uid, {
      ...generated,
      isSaved: recipe.isSaved,
    });
    setSelectedRecipe(saved);
  }

  async function handleMarkIngredientAvailableInRecipe(recipe: SavedRecipe, ingredientName: string) {
    if (!profile) return;
    const meta = normalizeIngredientMeta(ingredientName);
    const defaultQty = meta.defaultUnit === 'ml' ? 500 : meta.defaultUnit === 'pieces' ? 4 : 200;

    await applyInventoryActionTransaction(
      profile.uid,
      {
        action: 'RESTOCK_INGREDIENT',
        ingredient: meta.displayName,
        canonicalName: meta.canonicalName,
        quantity: defaultQty,
        unit: meta.defaultUnit,
        category: meta.category,
        confidence: 1,
        isPurchase: false,
      },
      'manual_ui',
      `Marked ${meta.displayName} available at home from recipe modal`,
    );

    const updatedInventory: InventoryItem[] = [
      ...inventory.filter(
        (i) => (i.canonicalName || normalizeIngredientMeta(i.name).canonicalName) !== meta.canonicalName,
      ),
      {
        id: `local_${meta.canonicalName}`,
        userId: profile.uid,
        canonicalName: meta.canonicalName,
        displayName: meta.displayName,
        name: meta.displayName,
        numericQuantity: defaultQty,
        unit: meta.defaultUnit,
        quantity: `${defaultQty}${meta.defaultUnit}`,
        category: meta.category,
        isRegular: true,
        isAvailable: true,
      },
    ];

    const currentBudget =
      recipe.appliedBudgetLimit !== undefined
        ? recipe.appliedBudgetLimit
        : profile.discoveryContext?.activeBudget !== undefined
          ? profile.discoveryContext.activeBudget
          : null;

    const recalc = calculateRecipeCostBreakdown(
      recipe.exactIngredients,
      updatedInventory,
      currentBudget,
    );

    const updatedFields = {
      servings: recipe.servings,
      exactIngredients: recalc.requiredIngredients,
      existingIngredients: recalc.availableIngredients,
      ingredientsToPurchase: recalc.missingIngredients,
      estimatedPurchaseCost: recalc.estimatedPurchaseCostText,
      ingredientConsumptionValueInr: recalc.ingredientConsumptionValueInr,
      missingIngredientValueInr: recalc.missingIngredientValueInr,
      actualShoppingOutlayInr: recalc.actualShoppingOutlayInr,
      appliedBudgetLimit: currentBudget,
    };

    await updateSavedRecipeBreakdown(profile.uid, recipe.id, updatedFields);
    setSelectedRecipe({ ...recipe, ...updatedFields });
  }

  async function handleToggleSaveRecipe(recipe: SavedRecipe) {
    if (!profile) return;
    const nextState = !recipe.isSaved;
    await toggleRecipeSaved(profile.uid, recipe.id, nextState);
    if (selectedRecipe?.id === recipe.id) {
      setSelectedRecipe({ ...selectedRecipe, isSaved: nextState });
    }
  }

  async function handleStartCookingMode(recipe: SavedRecipe) {
    setSelectedRecipe(null);
    setCookingRecipe(recipe);
    if (profile) {
      await updateConversationContext(profile.uid, 'COOKING_MODE', {
        ...(profile.discoveryContext || {}),
        selectedDishName: recipe.dishName,
      });
    }
  }

  async function handleExitCookingMode() {
    setCookingRecipe(null);
    if (profile) {
      await updateConversationContext(profile.uid, 'IDLE', {
        ...(profile.discoveryContext || {}),
      });
    }
  }

  async function handleCompleteMeal(dishName: string, deductedResults?: AppliedInventoryResult[]) {
    if (!profile) return;
    await updateRecentMeals(profile.uid, profile.recentMeals || [], [dishName]);
    await updateConversationContext(profile.uid, 'IDLE', {});
    const applied = (deductedResults || []).filter((r) => r.status === 'applied');
    const summaryText =
      applied.length > 0
        ? `Recipe complete! ${dishName} ke liye used ingredients inventory se minus kar diye. Baaki saman safe hai.`
        : `Recipe complete! ${dishName} ko tere recent meals mein log kar diya hai.`;
    await addChatMessage(profile.uid, {
      role: 'assistant',
      content: summaryText,
      buddyNameSnapshot: profile.buddyName || 'KhanaBanana',
      responseMode: 'GENERAL_CHAT',
      ...(applied.length > 0 ? { inventoryResults: applied } : {}),
    });
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-[#576560]">
          <Loader2 className="w-5 h-5 animate-spin text-[#1B4D3E]" />
          <span>Warming up your kitchen...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-[#576560]">
          <Loader2 className="w-5 h-5 animate-spin text-[#1B4D3E]" />
          <span>Loading your profile...</span>
        </div>
      </div>
    );
  }

  const buddyName = profile.buddyName || 'KhanaBanana';

  const navItems: { id: AppView; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'kitchen', label: 'My Kitchen', icon: Refrigerator },
    { id: 'recipes', label: 'My Recipes', icon: BookOpen },
    { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F3] flex flex-col">
      <header className="bg-white border-b border-[#E6E0D3] sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => setActiveView('chat')}
            className="font-display text-lg font-bold tracking-tight text-[#1B4D3E] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {buddyName}
          </button>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-[#1B4D3E] text-[#1A2421] font-semibold'
                      : 'border-transparent text-[#576560] hover:text-[#1A2421]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs font-medium text-[#576560] max-w-[140px] truncate">
              {profile.displayName}
            </span>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-8 pt-5 pb-20 md:pb-8">
        {activeView === 'chat' && (
          <ChatWorkspace
            profile={profile}
            inventory={inventory}
            recentTransactions={transactions}
            messages={messages}
            recipes={recipes}
            onGenerateAndOpenRecipe={handleGenerateAndOpenRecipe}
            onOpenRecipeById={(recipeId) => {
              const found = recipes.find((r) => r.id === recipeId);
              if (found) setSelectedRecipe(found);
            }}
            onGoToKitchen={() => setActiveView('kitchen')}
          />
        )}

        {activeView === 'kitchen' && (
          <MyKitchenView
            uid={profile.uid}
            buddyName={buddyName}
            inventory={inventory}
            transactions={transactions}
          />
        )}

        {activeView === 'recipes' && (
          <MyRecipesView
            uid={profile.uid}
            recipes={recipes}
            onOpenRecipe={(r) => setSelectedRecipe(r)}
            onStartCooking={handleStartCookingMode}
            onGoToChat={() => setActiveView('chat')}
          />
        )}

        {activeView === 'preferences' && <PreferencesView profile={profile} />}
      </main>

      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E6E0D3] grid grid-cols-4 h-14"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                active ? 'text-[#1B4D3E] font-semibold' : 'text-[#576560]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {selectedRecipe && !cookingRecipe && (
        <RecipeDetailModal
          recipe={selectedRecipe}
          onClose={() => setSelectedRecipe(null)}
          onStartCooking={handleStartCookingMode}
          onToggleSave={handleToggleSaveRecipe}
          onRegenerateForServings={handleRegenerateForServings}
          onMarkIngredientAvailable={handleMarkIngredientAvailableInRecipe}
        />
      )}

      {cookingRecipe && (
        <CookingModeView
          uid={profile.uid}
          recipe={cookingRecipe}
          inventory={inventory}
          buddyName={buddyName}
          preferredLanguage={profile.preferredLanguage}
          onExit={handleExitCookingMode}
          onCompleteMeal={handleCompleteMeal}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
