import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  PackageCheck,
  Send,
  X,
} from 'lucide-react';
import {
  findMatchingInventoryItem,
  normalizeUnit,
  parseQuantityString,
} from '../lib/inventoryUtils';
import { askCookingAssistant } from '../services/aiService';
import { consumeIngredientsBatch } from '../services/firestoreService';
import type { AppliedInventoryResult, InventoryItem, SavedRecipe } from '../types';

interface CookingModeViewProps {
  uid: string;
  recipe: SavedRecipe;
  inventory: InventoryItem[];
  buddyName: string;
  preferredLanguage: string;
  onExit: () => void;
  onCompleteMeal: (dishName: string, deductedResults?: AppliedInventoryResult[]) => Promise<void>;
}

interface CookingQaItem {
  question: string;
  answer: string;
}

interface EditableConsumeRow {
  name: string;
  matchedInStock: string;
  selected: boolean;
  quantity: number;
  unit: string;
}

const QUICK_RESCUE_QUESTIONS = [
  'Masala jal raha hai!',
  'Kitna paani daalu?',
  'Namak zyada ho gaya, kya karu?',
  'Induction pe wattage kitna rakhu?',
  'Gravy patli ho rahi hai',
];

export function CookingModeView({
  uid,
  recipe,
  inventory,
  buddyName,
  preferredLanguage,
  onExit,
  onCompleteMeal,
}: CookingModeViewProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(true);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaHistory, setQaHistory] = useState<CookingQaItem[]>([]);
  const [completing, setCompleting] = useState(false);
  const [showConsumeConfirm, setShowConsumeConfirm] = useState(false);

  const initialConsumeRows = useMemo<EditableConsumeRow[]>(() => {
    return recipe.exactIngredients.map((ing) => {
      const match = findMatchingInventoryItem(inventory, ing.name);
      const parsed =
        ing.numericQuantity !== undefined && ing.unit
          ? { numericQuantity: ing.numericQuantity, unit: normalizeUnit(ing.unit) }
          : parseQuantityString(ing.quantity, match?.unit || 'g');
      return {
        name: ing.name,
        matchedInStock: match ? `${match.displayName || match.name} (${match.quantity})` : 'Not tracked in My Kitchen',
        selected: Boolean(match && match.isAvailable && (match.numericQuantity ?? 1) > 0),
        quantity: parsed.numericQuantity,
        unit: parsed.unit,
      };
    });
  }, [recipe.exactIngredients, inventory]);

  const [consumeRows, setConsumeRows] = useState<EditableConsumeRow[]>(initialConsumeRows);

  const steps = recipe.steps;
  const currentStep = steps[stepIndex] || steps[0];
  const progressPercent = Math.round(((stepIndex + 1) / Math.max(steps.length, 1)) * 100);

  async function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setQaError(null);
    setQuestion('');
    try {
      const answer = await askCookingAssistant({
        question: trimmed,
        recipe,
        currentStepIndex: stepIndex,
        buddyName,
        preferredLanguage,
      });
      setQaHistory((prev) => [...prev, { question: trimmed, answer }]);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Could not reach cooking assistant.');
    } finally {
      setAsking(false);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    submitQuestion(question);
  }

  async function handleConfirmAndFinish(deductSelected: boolean) {
    setCompleting(true);
    try {
      let results: AppliedInventoryResult[] = [];
      if (deductSelected) {
        const chosen = consumeRows
          .filter((r) => r.selected && r.quantity > 0)
          .map((r) => ({ name: r.name, quantity: r.quantity, unit: r.unit }));
        if (chosen.length > 0) {
          results = await consumeIngredientsBatch(uid, chosen, recipe.dishName);
        }
      }
      await onCompleteMeal(recipe.dishName, results);
      setShowConsumeConfirm(false);
      onExit();
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#FAF8F3] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="bg-white border-b border-[#E6E0D3] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[#576560] flex items-center gap-2">
            <span>Cooking Mode</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#1B4D3E] font-semibold">
              Step {stepIndex + 1} of {steps.length}
            </span>
          </div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-[#1A2421] truncate">
            {recipe.dishName}
          </h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowConsumeConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F4C430]/35 hover:bg-[#F4C430]/55 text-xs font-semibold text-[#13382D] transition-colors whitespace-nowrap cursor-pointer"
          >
            <PackageCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Confirm Used Ingredients</span>
          </button>
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] transition-colors whitespace-nowrap cursor-pointer"
          >
            <ListChecks className="w-4 h-4 text-[#1B4D3E]" />
            <span className="hidden sm:inline">{showIngredients ? 'Hide Ingredients' : 'Ingredients'}</span>
          </button>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] transition-colors whitespace-nowrap cursor-pointer"
          >
            <X className="w-4 h-4" />
            Exit
          </button>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="h-1.5 w-full bg-[#E6E0D3] shrink-0">
        <div
          className="h-full bg-[#1B4D3E] transition-all duration-200"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Active Step Card + Live Buddy Help */}
          <div className={`${showIngredients ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-6`}>
            {/* Current Step Display */}
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-[#E6E0D3]">
                <span className="font-mono tabular-nums text-xs font-semibold text-[#1B4D3E]">
                  STAGE {String(currentStep.stepNumber).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
                </span>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-[#576560]">
                  <span className="inline-flex items-center gap-1.5 text-[#E06D2B] font-semibold">
                    <Flame className="w-4 h-4" />
                    {currentStep.heatLevel}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#1A2421] font-semibold">
                    <Clock className="w-4 h-4 text-[#1B4D3E]" />
                    {currentStep.duration}
                  </span>
                </div>
              </div>

              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#1A2421] mb-4">
                {currentStep.title}
              </h2>
              <p className="text-base sm:text-lg text-[#1A2421]/90 leading-relaxed mb-5">
                {currentStep.instruction}
              </p>

              {currentStep.tip && (
                <div className="p-4 rounded-xl bg-[#F4C430]/15 border border-[#F4C430]/40 text-sm text-[#1A2421]">
                  <span className="font-semibold text-[#13382D]">{buddyName} Tip: </span>
                  {currentStep.tip}
                </div>
              )}

              {/* Step Controls */}
              <div className="mt-8 pt-6 border-t border-[#E6E0D3] flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={stepIndex === 0}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-sm font-semibold text-[#1A2421] disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Previous
                </button>

                {stepIndex < steps.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Next Step
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConsumeConfirm(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#E06D2B] hover:bg-[#c85d20] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Finish & Confirm Usage
                  </button>
                )}
              </div>
            </div>

            {/* Live AI Question Box */}
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-6">
              <div className="flex items-center gap-2.5 mb-2">
                <MessageCircleQuestion className="w-5 h-5 text-[#1B4D3E]" />
                <h3 className="font-display text-base font-semibold text-[#1A2421]">
                  Ask {buddyName} Live Kitchen Help
                </h3>
              </div>
              <p className="text-xs text-[#576560] mb-4">
                {buddyName} knows you are on Step {stepIndex + 1} ({currentStep.title}) using {recipe.applianceType}. Ask anything mid-cook!
              </p>

              {/* Quick Rescue Prompts */}
              <div className="flex flex-wrap gap-2 mb-4">
                {QUICK_RESCUE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={asking}
                    onClick={() => submitQuestion(q)}
                    className="px-3 py-1.5 rounded-lg bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-medium text-[#1A2421] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {qaError && (
                <div className="mb-3 p-3 rounded-xl bg-[#E06D2B]/10 text-xs text-[#9A3412]">
                  {qaError}
                </div>
              )}

              {qaHistory.length > 0 && (
                <div className="mb-4 space-y-3 max-h-60 overflow-y-auto pr-1">
                  {qaHistory.map((item, idx) => (
                    <div key={idx} className="space-y-1.5 pb-3 border-b border-[#E6E0D3] last:border-b-0 last:pb-0">
                      <p className="text-xs font-semibold text-[#576560]">You: {item.question}</p>
                      <p className="text-sm text-[#1A2421] bg-[#F3EFE6] rounded-xl p-3 leading-relaxed">
                        <span className="font-semibold text-[#1B4D3E]">{buddyName}: </span>
                        {item.answer}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleFormSubmit} className="flex gap-2.5">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={`Ask ${buddyName} (e.g. "Induction 1200 watt pe hai, ab kya karu?")`}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                />
                <button
                  type="submit"
                  disabled={asking || !question.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Ask
                </button>
              </form>
            </div>
          </div>

          {/* Ingredient Reference Panel */}
          {showIngredients && (
            <aside className="lg:col-span-4 bg-white border border-[#E6E0D3] rounded-2xl p-6 h-fit">
              <h3 className="font-display text-base font-semibold text-[#1A2421] mb-1">
                Ingredients Reference
              </h3>
              <p className="text-xs text-[#576560] mb-4">
                {recipe.servings} servings · {recipe.requiredUtensils.join(', ')}
              </p>
              <ul className="divide-y divide-[#E6E0D3] text-sm">
                {recipe.exactIngredients.map((ing, idx) => (
                  <li key={idx} className="py-2 flex items-baseline justify-between gap-3">
                    <span className="text-[#1A2421]">{ing.name}</span>
                    <span className="font-mono tabular-nums text-xs font-semibold text-[#1B4D3E] shrink-0">
                      {ing.quantity}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 pt-4 border-t border-[#E6E0D3]">
                <h4 className="text-xs font-semibold text-[#576560] mb-1.5">Appliance Note</h4>
                <p className="text-xs text-[#1A2421]/85 leading-relaxed">{recipe.applianceGuidance}</p>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Confirm Actual Ingredient Usage Modal (No Auto-Deduction Without Confirmation) */}
      {showConsumeConfirm && (
        <div
          className="fixed inset-0 z-60 bg-[#13382D]/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm ingredients used"
        >
          <div className="bg-white border border-[#E6E0D3] rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6 sm:p-7 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-[#1A2421]">
                  Confirm Actual Ingredients Used
                </h2>
                <p className="text-xs sm:text-sm text-[#576560] mt-1">
                  Adjust actual quantities if you cooked partially or changed measurements. Only
                  checked items will be deducted from My Kitchen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConsumeConfirm(false)}
                className="p-2 rounded-xl hover:bg-[#F3EFE6] text-[#576560] cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-[#E6E0D3] border border-[#E6E0D3] rounded-xl px-4">
              {consumeRows.map((row, idx) => (
                <div key={idx} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(e) => {
                        const next = [...consumeRows];
                        next[idx] = { ...row, selected: e.target.checked };
                        setConsumeRows(next);
                      }}
                      className="mt-1 rounded border-[#E6E0D3] text-[#1B4D3E]"
                    />
                    <div>
                      <span className="text-sm font-medium text-[#1A2421] block">{row.name}</span>
                      <span className="text-xs text-[#576560]">In Kitchen: {row.matchedInStock}</span>
                    </div>
                  </label>

                  <div className="flex items-center gap-2 pl-7 sm:pl-0 shrink-0">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={!row.selected}
                      value={row.quantity}
                      onChange={(e) => {
                        const next = [...consumeRows];
                        next[idx] = { ...row, quantity: Math.max(0, Number(e.target.value) || 0) };
                        setConsumeRows(next);
                      }}
                      className="w-20 px-2.5 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] text-xs font-mono tabular-nums text-[#1A2421] disabled:opacity-40"
                    />
                    <input
                      type="text"
                      disabled={!row.selected}
                      value={row.unit}
                      onChange={(e) => {
                        const next = [...consumeRows];
                        next[idx] = { ...row, unit: e.target.value };
                        setConsumeRows(next);
                      }}
                      className="w-20 px-2.5 py-1.5 rounded-lg border border-[#E6E0D3] bg-[#FAF8F3] text-xs font-mono text-[#1A2421] disabled:opacity-40"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                disabled={completing}
                onClick={() => handleConfirmAndFinish(false)}
                className="px-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-xs font-semibold text-[#576560] cursor-pointer"
              >
                Skip Deduction & Finish
              </button>

              <button
                type="button"
                disabled={completing}
                onClick={() => handleConfirmAndFinish(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {completing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Confirm & Deduct from Kitchen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
