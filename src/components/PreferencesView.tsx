import { useState, type FormEvent } from 'react';
import { Check, Loader2, Plus, Save, Sparkles, X } from 'lucide-react';
import { MEDIA_ASSETS } from '../lib/mediaAssets';
import { updateMemoryNotes, updateRecentMeals, updateUserPreferences } from '../services/firestoreService';
import {
  FIELD_LIMITS,
  type ConversationStyle,
  type CookingEquipment,
  type DietaryPreference,
  type HumourLevel,
  type PreferredLanguage,
  type PrepTimePreference,
  type SpiceTolerance,
  type UserProfile,
  type UtensilPreference,
} from '../types';

interface PreferencesViewProps {
  profile: UserProfile;
}

const BUDDY_NAME_PRESETS = ['KhanaBanana', 'Bawarchi', 'Chef Babu', 'Petu', 'Rasoi Dost'];
const CUISINE_OPTIONS = [
  'North Indian',
  'South Indian',
  'Bengali',
  'Street Food',
  'Indo-Chinese',
  'Simple Continental',
  'Everyday Bachelor',
];

export function PreferencesView({ profile }: PreferencesViewProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [buddyName, setBuddyName] = useState(profile.buddyName || 'KhanaBanana');
  const [humourLevel, setHumourLevel] = useState<HumourLevel>(
    profile.humourLevel || 'Friendly teasing',
  );
  const [conversationStyle, setConversationStyle] = useState<ConversationStyle>(
    profile.conversationStyle || 'Warm & Detailed',
  );
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage>(
    profile.preferredLanguage,
  );
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>(
    profile.dietaryPreference,
  );
  const [spiceTolerance, setSpiceTolerance] = useState<SpiceTolerance>(profile.spiceTolerance);
  const [favouriteCuisines, setFavouriteCuisines] = useState<string[]>(
    profile.favouriteCuisines || [],
  );
  const [allergies, setAllergies] = useState<string[]>(profile.allergies || []);
  const [allergyInput, setAllergyInput] = useState('');
  const [dislikedIngredients, setDislikedIngredients] = useState<string[]>(
    profile.dislikedIngredients || [],
  );
  const [dislikedInput, setDislikedInput] = useState('');
  const [defaultEquipment, setDefaultEquipment] = useState<CookingEquipment>(
    profile.defaultEquipment,
  );
  const [defaultUtensils, setDefaultUtensils] = useState<UtensilPreference>(
    profile.defaultUtensils,
  );
  const [defaultServings, setDefaultServings] = useState<number>(profile.defaultServings || 2);
  const [preferredPrepTime, setPreferredPrepTime] = useState<PrepTimePreference>(
    profile.preferredPrepTime,
  );
  const [defaultBudgetInput, setDefaultBudgetInput] = useState<string>(
    profile.hasExplicitDefaultBudget &&
      profile.defaultBudget !== null &&
      profile.defaultBudget !== undefined
      ? String(profile.defaultBudget)
      : '',
  );

  const [newMealInput, setNewMealInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  function toggleCuisine(c: string) {
    setFavouriteCuisines((prev) =>
      prev.includes(c) ? prev.filter((item) => item !== c) : [...prev, c].slice(0, 10),
    );
  }

  function addAllergy() {
    const val = allergyInput.trim();
    if (val && !allergies.includes(val) && allergies.length < FIELD_LIMITS.ALLERGIES_MAX) {
      setAllergies([...allergies, val]);
      setAllergyInput('');
    }
  }

  function addDisliked() {
    const val = dislikedInput.trim();
    if (
      val &&
      !dislikedIngredients.includes(val) &&
      dislikedIngredients.length < FIELD_LIMITS.DISLIKED_MAX
    ) {
      setDislikedIngredients([...dislikedIngredients, val]);
      setDislikedInput('');
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await updateUserPreferences(profile.uid, {
        displayName: displayName.trim() || profile.displayName,
        buddyName: buddyName.trim() || 'KhanaBanana',
        humourLevel,
        conversationStyle,
        preferredLanguage,
        dietaryPreference,
        spiceTolerance,
        favouriteCuisines,
        allergies,
        dislikedIngredients,
        defaultEquipment,
        defaultUtensils,
        defaultServings,
        preferredPrepTime,
        defaultBudget:
          defaultBudgetInput.trim() === ''
            ? null
            : Math.max(0, Math.min(10000, Math.round(Number(defaultBudgetInput) || 0))),
        hasExplicitDefaultBudget: defaultBudgetInput.trim() !== '',
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickBuddyPreset(name: string) {
    setBuddyName(name);
    await updateUserPreferences(profile.uid, { buddyName: name });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  }

  async function handleAddRecentMeal() {
    const val = newMealInput.trim();
    if (!val) return;
    await updateRecentMeals(profile.uid, profile.recentMeals || [], [val]);
    setNewMealInput('');
  }

  async function handleRemoveRecentMeal(meal: string) {
    const next = (profile.recentMeals || []).filter((m) => m !== meal);
    await updateRecentMeals(profile.uid, [], next);
  }

  async function handleRemoveMemoryNote(note: string) {
    const next = (profile.memoryNotes || []).filter((n) => n !== note);
    await updateMemoryNotes(profile.uid, next);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A2421]">
          My Food Buddy Settings
        </h1>
        <p className="text-sm text-[#576560] mt-1">
          Customise your companion's name, humour level, conversation style, and kitchen defaults
          without losing your chat history.
        </p>
      </div>

      {/* Major Feature Spotlight: Name & Personality of Your Food Buddy */}
      <section className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <img
            src={MEDIA_ASSETS.buddyAvatar}
            alt={buddyName}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover border border-[#E6E0D3] bg-[#FAF8F3] shrink-0"
          />
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E06D2B] mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Companion Identity & Personality</span>
            </div>
            <h2 className="font-display text-xl font-bold text-[#1A2421]">
              Name your food buddy
            </h2>
            <p className="text-sm text-[#576560] mt-0.5">
              Preview: "Namaste! Main tera <strong className="text-[#1B4D3E]">{buddyName || 'KhanaBanana'}</strong>. Aaj kya pakana hai?"
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {BUDDY_NAME_PRESETS.map((preset) => {
              const active = buddyName === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleQuickBuddyPreset(preset)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#1B4D3E] text-white'
                      : 'bg-[#F3EFE6] hover:bg-[#E6E0D3] text-[#1A2421]'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div>
              <label htmlFor="buddy-name-input" className="block text-xs font-medium text-[#576560] mb-1.5">
                Custom Buddy Name
              </label>
              <input
                id="buddy-name-input"
                type="text"
                value={buddyName}
                onChange={(e) => setBuddyName(e.target.value)}
                maxLength={FIELD_LIMITS.BUDDY_NAME_MAX}
                placeholder="e.g. Bawarchi, Chef Babu"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm font-medium text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              />
            </div>

            <div>
              <label htmlFor="pref-humour" className="block text-xs font-medium text-[#576560] mb-1.5">
                Humour Level
              </label>
              <select
                id="pref-humour"
                value={humourLevel}
                onChange={(e) => setHumourLevel(e.target.value as HumourLevel)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              >
                <option value="Mild">Mild</option>
                <option value="Friendly teasing">Friendly teasing (Default)</option>
                <option value="Full-on desi dost">Full-on desi dost</option>
              </select>
            </div>

            <div>
              <label htmlFor="pref-style" className="block text-xs font-medium text-[#576560] mb-1.5">
                Conversation Style
              </label>
              <select
                id="pref-style"
                value={conversationStyle}
                onChange={(e) => setConversationStyle(e.target.value as ConversationStyle)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              >
                <option value="Warm & Detailed">Warm & Detailed</option>
                <option value="Short & Punchy">Short & Punchy</option>
                <option value="Pure Desi Banter">Pure Desi Banter</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Main Preferences Form */}
      <form
        onSubmit={handleSave}
        className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-7 space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="pref-display-name" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Your Name
            </label>
            <input
              id="pref-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={FIELD_LIMITS.DISPLAY_NAME_MAX}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            />
          </div>

          <div>
            <label htmlFor="pref-language" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Preferred Language
            </label>
            <select
              id="pref-language"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as PreferredLanguage)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="Hinglish">Hinglish (Friendly Hindi + English)</option>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-diet" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Dietary Preference
            </label>
            <select
              id="pref-diet"
              value={dietaryPreference}
              onChange={(e) => setDietaryPreference(e.target.value as DietaryPreference)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="Vegetarian">Vegetarian</option>
              <option value="Eggetarian">Eggetarian</option>
              <option value="Non-Vegetarian">Non-Vegetarian</option>
              <option value="Vegan">Vegan</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-spice" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Spice Tolerance
            </label>
            <select
              id="pref-spice"
              value={spiceTolerance}
              onChange={(e) => setSpiceTolerance(e.target.value as SpiceTolerance)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="Mild">Mild</option>
              <option value="Medium">Medium</option>
              <option value="Spicy">Spicy</option>
              <option value="Extra Spicy">Extra Spicy</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-equip" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Default Cooking Equipment
            </label>
            <select
              id="pref-equip"
              value={defaultEquipment}
              onChange={(e) => setDefaultEquipment(e.target.value as CookingEquipment)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="Gas Stove">Gas Stove</option>
              <option value="Induction">Induction Cooktop</option>
              <option value="Both">Both Gas & Induction</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-utensils" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Default Utensils
            </label>
            <select
              id="pref-utensils"
              value={defaultUtensils}
              onChange={(e) => setDefaultUtensils(e.target.value as UtensilPreference)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="One Pan / Kadhai">One Pan / Kadhai</option>
              <option value="Pressure Cooker + Pan">Pressure Cooker + Pan</option>
              <option value="Multiple Utensils">Multiple Utensils</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-servings" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Default Servings
            </label>
            <input
              id="pref-servings"
              type="number"
              min={1}
              max={12}
              value={defaultServings}
              onChange={(e) => setDefaultServings(Number(e.target.value) || 1)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm font-mono tabular-nums text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            />
          </div>

          <div>
            <label htmlFor="pref-prep-time" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Preferred Preparation Time
            </label>
            <select
              id="pref-prep-time"
              value={preferredPrepTime}
              onChange={(e) => setPreferredPrepTime(e.target.value as PrepTimePreference)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="Under 15 mins">Under 15 mins</option>
              <option value="15-30 mins">15-30 mins</option>
              <option value="30-45 mins">30-45 mins</option>
              <option value="No limit">No limit</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-budget" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Optional Default Shopping Budget (₹)
            </label>
            <div className="flex gap-2">
              <input
                id="pref-budget"
                type="number"
                min={0}
                max={10000}
                value={defaultBudgetInput}
                onChange={(e) => setDefaultBudgetInput(e.target.value)}
                placeholder="No budget limit (default)"
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm font-mono tabular-nums text-[#1A2421] placeholder:font-sans placeholder:text-[#576560]/70 focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              />
              {defaultBudgetInput.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => setDefaultBudgetInput('')}
                  className="px-3 py-2 rounded-xl border border-[#E6E0D3] bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-semibold text-[#1A2421] cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-[#576560] mt-1">
              Leave blank for no default spending cap. You can set a budget anytime in chat.
            </p>
          </div>
        </div>

        {/* Favourite Cuisines */}
        <div className="pt-4 border-t border-[#E6E0D3]">
          <p className="text-xs font-semibold text-[#1A2421] mb-2.5">Favourite Cuisines</p>
          <div className="flex flex-wrap gap-2">
            {CUISINE_OPTIONS.map((c) => {
              const selected = favouriteCuisines.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCuisine(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#1B4D3E] text-white'
                      : 'bg-[#F3EFE6] text-[#576560] hover:text-[#1A2421]'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* Allergies & Dislikes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-[#E6E0D3]">
          <div>
            <label htmlFor="allergy-input" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Allergies (Strictly Avoided)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="allergy-input"
                type="text"
                value={allergyInput}
                onChange={(e) => setAllergyInput(e.target.value)}
                placeholder="e.g. Peanuts, Shellfish"
                className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-xs"
              />
              <button
                type="button"
                onClick={addAllergy}
                className="px-3 py-2 rounded-xl bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-semibold cursor-pointer"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {allergies.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 text-[#9A3412] font-medium">
                  {a}
                  <button
                    type="button"
                    onClick={() => setAllergies(allergies.filter((x) => x !== a))}
                    aria-label={`Remove ${a}`}
                    className="hover:text-[#1A2421] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="dislike-input" className="block text-xs font-semibold text-[#1A2421] mb-1.5">
              Disliked Ingredients
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="dislike-input"
                type="text"
                value={dislikedInput}
                onChange={(e) => setDislikedInput(e.target.value)}
                placeholder="e.g. Karela, Brinjal"
                className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-xs"
              />
              <button
                type="button"
                onClick={addDisliked}
                className="px-3 py-2 rounded-xl bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-semibold cursor-pointer"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {dislikedIngredients.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 text-[#576560] font-medium">
                  {d}
                  <button
                    type="button"
                    onClick={() =>
                      setDislikedIngredients(dislikedIngredients.filter((x) => x !== d))
                    }
                    aria-label={`Remove ${d}`}
                    className="hover:text-[#1A2421] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-[#E6E0D3] flex items-center justify-between gap-4">
          {savedNotice ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1B4D3E]">
              <Check className="w-4 h-4" />
              Preferences saved & synced!
            </span>
          ) : (
            <span className="text-xs text-[#576560]">
              Changes apply immediately to your next message.
            </span>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Preferences
          </button>
        </div>
      </form>

      {/* Recent Meals History (Anti-Repetition Tracker) */}
      <section className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-7 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A2421]">
            Recent Meals History
          </h2>
          <p className="text-xs text-[#576560] mt-0.5">
            {buddyName || 'KhanaBanana'} tracks what you ate yesterday or recently so it avoids
            repeating the same dishes.
          </p>
        </div>

        <div className="flex gap-2 max-w-md">
          <input
            type="text"
            value={newMealInput}
            onChange={(e) => setNewMealInput(e.target.value)}
            placeholder="Log a recent meal (e.g. Dal Chawal)"
            className="flex-1 px-3.5 py-2 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm"
          />
          <button
            type="button"
            onClick={handleAddRecentMeal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-semibold text-[#1A2421] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Meal
          </button>
        </div>

        {profile.recentMeals?.length > 0 ? (
          <div className="divide-y divide-[#E6E0D3] border border-[#E6E0D3] rounded-xl px-4">
            {profile.recentMeals.map((meal) => (
              <div key={meal} className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-[#1A2421]">{meal}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRecentMeal(meal)}
                  className="text-xs text-[#576560] hover:text-[#E06D2B] cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#576560]">
            No recent meals logged yet. Mention what you ate yesterday in Chat or add it here.
          </p>
        )}
      </section>

      {/* Persistent Long-Term AI Memory Notes */}
      <section className="bg-white border border-[#E6E0D3] rounded-2xl p-6 sm:p-7 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A2421]">
            Persistent Food Memory
          </h2>
          <p className="text-xs text-[#576560] mt-0.5">
            Long-term tastes, feedback, and habits remembered by {buddyName || 'KhanaBanana'}.
            Typing <span className="font-mono font-semibold text-[#1B4D3E]">/*clear</span> clears
            chat messages without erasing this memory.
          </p>
        </div>

        {profile.memoryNotes && profile.memoryNotes.length > 0 ? (
          <div className="divide-y divide-[#E6E0D3] border border-[#E6E0D3] rounded-xl px-4">
            {profile.memoryNotes.map((note) => (
              <div key={note} className="py-2.5 flex items-center justify-between text-sm gap-4">
                <span className="text-[#1A2421]">{note}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveMemoryNote(note)}
                  className="text-xs text-[#576560] hover:text-[#E06D2B] shrink-0 cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#576560]">
            Mention lasting preferences in chat (e.g. "Mujhe spicy food pasand hai") and{' '}
            {buddyName || 'KhanaBanana'} will remember them even after clearing chat.
          </p>
        )}
      </section>
    </div>
  );
}
