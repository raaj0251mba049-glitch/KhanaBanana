import { useEffect, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChefHat,
  Clock,
  Flame,
  Play,
  RefreshCw,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react';
import { getDishImage } from '../lib/mediaAssets';
import type { SavedRecipe } from '../types';
import { SafeImage } from './SafeImage';

interface RecipeDetailModalProps {
  recipe: SavedRecipe;
  onClose: () => void;
  onStartCooking: (recipe: SavedRecipe) => void;
  onToggleSave: (recipe: SavedRecipe) => Promise<void>;
  onRegenerateForServings?: (recipe: SavedRecipe, newServings: number) => Promise<void>;
  onMarkIngredientAvailable?: (recipe: SavedRecipe, ingredientName: string) => Promise<void>;
}

export function RecipeDetailModal({
  recipe,
  onClose,
  onStartCooking,
  onToggleSave,
  onRegenerateForServings,
  onMarkIngredientAvailable,
}: RecipeDetailModalProps) {
  const [saving, setSaving] = useState(false);
  const [rescaling, setRescaling] = useState(false);
  const [markingItem, setMarkingItem] = useState<string | null>(null);
  const [targetServings, setTargetServings] = useState(recipe.servings);

  useEffect(() => {
    setTargetServings(recipe.servings);
  }, [recipe.servings]);

  async function handleToggleSave() {
    setSaving(true);
    try {
      await onToggleSave(recipe);
    } finally {
      setSaving(false);
    }
  }

  async function handleRescale(nextServings: number) {
    if (!onRegenerateForServings || nextServings < 1 || nextServings > 12) return;
    setTargetServings(nextServings);
    setRescaling(true);
    try {
      await onRegenerateForServings(recipe, nextServings);
    } finally {
      setRescaling(false);
    }
  }

  async function handleMarkAvailable(itemName: string) {
    if (!onMarkIngredientAvailable || markingItem) return;
    setMarkingItem(itemName);
    try {
      await onMarkIngredientAvailable(recipe, itemName);
    } finally {
      setMarkingItem(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[#13382D]/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={recipe.dishName}
    >
      <div className="bg-[#FAF8F3] border border-[#E6E0D3] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-xl">
        {/* Top Hero Image & Sticky Header */}
        <div className="relative h-52 sm:h-64 w-full overflow-hidden rounded-t-2xl bg-[#13382D]">
          <SafeImage
            src={getDishImage(recipe.imageCategory)}
            alt={recipe.dishName}
            className="w-full h-full object-cover"
            fallbackTitle={recipe.dishName}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#13382D]/95 via-[#13382D]/45 to-transparent" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close recipe"
            className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-white/95 text-[#1A2421] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="absolute bottom-5 left-6 right-6 text-white">
            <div className="text-xs font-medium text-[#F4C430] mb-1.5 flex flex-wrap items-center gap-2">
              <span>{recipe.cuisine}</span>
              <span aria-hidden="true">·</span>
              <span>{recipe.difficulty}</span>
              <span aria-hidden="true">·</span>
              <span>{recipe.spiceLevel}</span>
              <span aria-hidden="true">·</span>
              <span>{recipe.applianceType} Friendly</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight">
              {recipe.dishName}
            </h2>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white border-b border-[#E6E0D3] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-5 text-sm text-[#576560]">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[#1A2421]">
              <Users className="w-4 h-4 text-[#1B4D3E]" />
              {recipe.servings} servings
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Clock className="w-4 h-4 text-[#1B4D3E]" />
              Prep {recipe.prepTime}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Flame className="w-4 h-4 text-[#E06D2B]" />
              Cook {recipe.cookTime}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[#1B4D3E] font-medium">
              <ShoppingBag className="w-4 h-4" />
              Est. buy: {recipe.estimatedPurchaseCost}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-sm font-medium text-[#1A2421] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {recipe.isSaved ? (
                <>
                  <BookmarkCheck className="w-4 h-4 text-[#1B4D3E]" />
                  Saved
                </>
              ) : (
                <>
                  <Bookmark className="w-4 h-4" />
                  Save Recipe
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onStartCooking(recipe)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              START COOKING
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6 sm:p-8 space-y-8">
          {/* Description + Servings Adjuster */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <p className="text-[15px] text-[#1A2421] leading-relaxed max-w-2xl">
              {recipe.description}
            </p>
            {onRegenerateForServings && (
              <div className="flex items-center gap-2 shrink-0 bg-white border border-[#E6E0D3] rounded-xl px-3 py-2">
                <span className="text-xs font-medium text-[#576560]">Scale servings:</span>
                <button
                  type="button"
                  disabled={rescaling || targetServings <= 1}
                  onClick={() => handleRescale(targetServings - 1)}
                  className="w-7 h-7 rounded-lg bg-[#F3EFE6] text-[#1A2421] font-mono text-sm font-semibold hover:bg-[#E6E0D3] disabled:opacity-40 cursor-pointer"
                >
                  -
                </button>
                <span className="w-6 text-center font-mono tabular-nums text-sm font-semibold">
                  {targetServings}
                </span>
                <button
                  type="button"
                  disabled={rescaling || targetServings >= 12}
                  onClick={() => handleRescale(targetServings + 1)}
                  className="w-7 h-7 rounded-lg bg-[#F3EFE6] text-[#1A2421] font-mono text-sm font-semibold hover:bg-[#E6E0D3] disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
                {rescaling && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#1B4D3E]" />}
              </div>
            )}
          </div>

          {/* Three-Tier Transparent Cost Breakdown */}
          {(recipe.ingredientConsumptionValueInr !== undefined ||
            recipe.missingIngredientValueInr !== undefined ||
            recipe.actualShoppingOutlayInr !== undefined) && (
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[#576560]">From Your Kitchen Stock</p>
                <p className="font-mono tabular-nums text-lg font-bold text-[#1B4D3E]">
                  ₹{recipe.ingredientConsumptionValueInr ?? 0}
                </p>
                <p className="text-[11px] text-[#576560]">Est. consumption value used</p>
              </div>
              <div>
                <p className="text-xs text-[#576560]">Missing Portion Value</p>
                <p className="font-mono tabular-nums text-lg font-bold text-[#1A2421]">
                  ₹{recipe.missingIngredientValueInr ?? 0}
                </p>
                <p className="text-[11px] text-[#576560]">Portion cost of missing items</p>
              </div>
              <div>
                <p className="text-xs text-[#576560]">Est. Shop Outlay (Pack Sizes)</p>
                <p className="font-mono tabular-nums text-lg font-bold text-[#E06D2B]">
                  ₹{recipe.actualShoppingOutlayInr ?? 0}
                </p>
                <p className="text-[11px] text-[#576560]">
                  {recipe.appliedBudgetLimit !== undefined && recipe.appliedBudgetLimit !== null
                    ? (recipe.actualShoppingOutlayInr ?? 0) <= recipe.appliedBudgetLimit
                      ? `Fits ₹${recipe.appliedBudgetLimit} budget`
                      : `Exceeds ₹${recipe.appliedBudgetLimit} budget`
                    : 'Practical retail shop spend'}
                </p>
              </div>
            </div>
          )}

          {/* Kitchen Split: Existing vs To Buy */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6">
              <h3 className="font-display text-base font-semibold text-[#1B4D3E] mb-3">
                Already in Your Kitchen
              </h3>
              {recipe.existingIngredients.length > 0 ? (
                <ul className="space-y-2 text-sm text-[#1A2421]">
                  {recipe.existingIngredients.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="text-[#1B4D3E] font-semibold">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#576560]">No matched items currently in stock in My Kitchen.</p>
              )}
            </div>

            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-base font-semibold text-[#E06D2B]">
                  Shopping List ({recipe.estimatedPurchaseCost})
                </h3>
              </div>
              {recipe.ingredientsToPurchase.length > 0 ? (
                <ul className="divide-y divide-[#E6E0D3] text-sm">
                  {recipe.ingredientsToPurchase.map((item, idx) => {
                    const isMarking = markingItem === item.name;
                    return (
                      <li key={idx} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-[#1A2421]">{item.name}</div>
                          <div className="text-xs text-[#576560]">
                            {item.neededQuantity ? `Need ${item.neededQuantity} · ` : ''}
                            {item.purchasePackQuantity ? `Buy ${item.purchasePackQuantity}` : item.quantity}
                            {' · '}
                            <span className={item.isEssential ? 'font-semibold text-[#1A2421]' : ''}>
                              {item.isEssential ? 'Essential' : 'Optional'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono tabular-nums text-xs font-semibold text-[#1B4D3E]">
                            {item.estimatedPriceRange}
                          </span>
                          {onMarkIngredientAvailable && (
                            <button
                              type="button"
                              disabled={Boolean(markingItem)}
                              onClick={() => handleMarkAvailable(item.name)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-[11px] font-semibold text-[#1B4D3E] whitespace-nowrap cursor-pointer"
                              title="Already have this at home? Add to kitchen & recalculate"
                            >
                              {isMarking ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <>
                                  <Check className="w-3 h-3" />
                                  Have it
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-[#1B4D3E] font-medium">
                  Zero extra shopping needed! Everything is cooked from what you have.
                </p>
              )}
            </div>
          </div>

          {/* Exact Quantities + Utensils & Appliance Guidance */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-7 bg-white border border-[#E6E0D3] rounded-2xl p-6">
              <h3 className="font-display text-base font-semibold text-[#1A2421] mb-4">
                Exact Ingredient Quantities ({recipe.servings} servings)
              </h3>
              <ul className="divide-y divide-[#E6E0D3] text-sm">
                {recipe.exactIngredients.map((ing, idx) => (
                  <li key={idx} className="py-2.5 flex items-baseline justify-between gap-4">
                    <div>
                      <span className="font-medium text-[#1A2421]">{ing.name}</span>
                      {ing.isEssential === false && (
                        <span className="text-[11px] text-[#576560] ml-2">(Optional)</span>
                      )}
                      {ing.notes && <span className="text-xs text-[#576560] ml-2">({ing.notes})</span>}
                    </div>
                    <span className="font-mono tabular-nums text-xs font-semibold text-[#1B4D3E] shrink-0">
                      {ing.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-5 bg-white border border-[#E6E0D3] rounded-2xl p-6 space-y-5">
              <div>
                <h3 className="font-display text-base font-semibold text-[#1A2421] mb-2">
                  Required Utensils
                </h3>
                <p className="text-sm text-[#576560]">
                  {recipe.requiredUtensils.join(' · ')}
                </p>
              </div>
              <div className="pt-4 border-t border-[#E6E0D3]">
                <h3 className="font-display text-base font-semibold text-[#1A2421] mb-2 flex items-center gap-2">
                  <ChefHat className="w-4 h-4 text-[#E06D2B]" />
                  {recipe.applianceType} Instructions
                </h3>
                <p className="text-sm text-[#576560] leading-relaxed">
                  {recipe.applianceGuidance}
                </p>
              </div>
            </div>
          </div>

          {/* Detailed Cooking Steps */}
          <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h3 className="font-display text-lg font-semibold text-[#1A2421]">
                Step-by-Step Method ({recipe.steps.length} stages)
              </h3>
              <button
                type="button"
                onClick={() => onStartCooking(recipe)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F4C430] hover:bg-[#eab308] text-[#13382D] text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Open Interactive Cooking Mode
              </button>
            </div>

            <ol className="divide-y divide-[#E6E0D3]">
              {recipe.steps.map((step) => (
                <li key={step.stepNumber} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                    <h4 className="font-display font-semibold text-[#1A2421]">
                      <span className="font-mono tabular-nums text-[#1B4D3E] mr-2">
                        {String(step.stepNumber).padStart(2, '0')}.
                      </span>
                      {step.title}
                    </h4>
                    <div className="text-xs text-[#576560] font-mono tabular-nums">
                      <span>{step.heatLevel}</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span>{step.duration}</span>
                    </div>
                  </div>
                  <p className="text-sm text-[#1A2421]/90 leading-relaxed">{step.instruction}</p>
                  {step.tip && (
                    <p className="text-xs text-[#1B4D3E] mt-2 font-medium">
                      Tip: {step.tip}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Pro Chef Notes: Taste Enhancers, Substitutions, Mistakes, Storage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6 space-y-5">
              <div>
                <h4 className="font-display text-sm font-semibold text-[#1B4D3E] mb-2">
                  Taste Enhancement Tricks
                </h4>
                <ul className="space-y-1.5 text-sm text-[#1A2421]">
                  {recipe.tasteEnhancers.map((item, idx) => (
                    <li key={idx}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="pt-4 border-t border-[#E6E0D3]">
                <h4 className="font-display text-sm font-semibold text-[#1A2421] mb-2">
                  Smart Substitutions
                </h4>
                <ul className="space-y-1.5 text-sm text-[#576560]">
                  {recipe.substitutions.map((item, idx) => (
                    <li key={idx}>• {item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6 space-y-5">
              <div>
                <h4 className="font-display text-sm font-semibold text-[#E06D2B] mb-2">
                  Common Mistakes to Avoid
                </h4>
                <ul className="space-y-1.5 text-sm text-[#1A2421]">
                  {recipe.commonMistakes.map((item, idx) => (
                    <li key={idx}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="pt-4 border-t border-[#E6E0D3]">
                <h4 className="font-display text-sm font-semibold text-[#1A2421] mb-2">
                  Storage & Leftovers
                </h4>
                <p className="text-sm text-[#576560] leading-relaxed">{recipe.storageGuidance}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
