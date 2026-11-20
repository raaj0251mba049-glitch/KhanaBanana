import { useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import { getDishImage } from '../lib/mediaAssets';
import { deleteSavedRecipe, toggleRecipeSaved } from '../services/firestoreService';
import type { SavedRecipe } from '../types';
import { SafeImage } from './SafeImage';

interface MyRecipesViewProps {
  uid: string;
  recipes: SavedRecipe[];
  onOpenRecipe: (recipe: SavedRecipe) => void;
  onStartCooking: (recipe: SavedRecipe) => void;
  onGoToChat: () => void;
}

export function MyRecipesView({
  uid,
  recipes,
  onOpenRecipe,
  onStartCooking,
  onGoToChat,
}: MyRecipesViewProps) {
  const [filter, setFilter] = useState<'saved' | 'all'>('all');
  const [search, setSearch] = useState('');

  const visibleRecipes = recipes.filter((r) => {
    const matchesFilter = filter === 'all' || r.isSaved;
    const q = search.toLowerCase();
    const matchesSearch =
      r.dishName.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A2421]">
            My Recipes
          </h1>
          <p className="text-sm text-[#576560] mt-1">
            Personalized recipes tailored to your kitchen, budget, and appliances.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F3EFE6] rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'all' ? 'bg-white text-[#1A2421] shadow-xs' : 'text-[#576560]'
            }`}
          >
            All Generated ({recipes.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('saved')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'saved' ? 'bg-white text-[#1A2421] shadow-xs' : 'text-[#576560]'
            }`}
          >
            Saved Favorites ({recipes.filter((r) => r.isSaved).length})
          </button>
        </div>
      </div>

      {recipes.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 text-[#576560] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes by name or cuisine..."
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-[#E6E0D3] bg-white text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
          />
        </div>
      )}

      {visibleRecipes.length === 0 ? (
        <div className="bg-white border border-[#E6E0D3] rounded-2xl p-10 text-center">
          <BookOpen className="w-10 h-10 text-[#1B4D3E]/50 mx-auto mb-3" />
          <h3 className="font-display text-lg font-semibold text-[#1A2421] mb-1">
            {recipes.length === 0 ? 'No recipes generated yet' : 'No matching recipes'}
          </h3>
          <p className="text-sm text-[#576560] mb-5 max-w-md mx-auto">
            {recipes.length === 0
              ? 'Ask your food buddy in Chat to suggest a dish, then click Generate Full Recipe to save and cook step-by-step.'
              : 'Try switching to All Generated or clearing your search.'}
          </p>
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#13382D] transition-colors cursor-pointer"
          >
            Discover Dishes in Chat
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleRecipes.map((recipe) => (
            <article
              key={recipe.id}
              className="bg-white border border-[#E6E0D3] rounded-2xl overflow-hidden flex flex-col justify-between"
            >
              <div>
                <div className="h-44 w-full overflow-hidden bg-[#E6E0D3]">
                  <SafeImage
                    src={getDishImage(recipe.imageCategory)}
                    alt={recipe.dishName}
                    className="w-full h-full object-cover"
                    fallbackTitle={recipe.dishName}
                  />
                </div>
                <div className="p-5">
                  <div className="text-xs text-[#576560] font-mono tabular-nums mb-1.5">
                    {recipe.cuisine} · {recipe.cookTime} · {recipe.servings} servings · {recipe.applianceType}
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#1A2421] mb-1.5">
                    {recipe.dishName}
                  </h2>
                  <p className="text-sm text-[#576560] line-clamp-2 leading-relaxed">
                    {recipe.description}
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5 pt-3 border-t border-[#E6E0D3] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenRecipe(recipe)}
                    className="px-3.5 py-2 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1A2421] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    View Recipe
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCooking(recipe)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Cook
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleRecipeSaved(uid, recipe.id, !recipe.isSaved)}
                    aria-label={recipe.isSaved ? 'Remove from saved' : 'Save recipe'}
                    className="p-2 rounded-lg text-[#576560] hover:text-[#1B4D3E] hover:bg-[#F3EFE6] transition-colors cursor-pointer"
                  >
                    {recipe.isSaved ? (
                      <BookmarkCheck className="w-4 h-4 text-[#1B4D3E]" />
                    ) : (
                      <Bookmark className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSavedRecipe(uid, recipe.id)}
                    aria-label={`Delete ${recipe.dishName}`}
                    className="p-2 rounded-lg text-[#576560] hover:text-[#E06D2B] hover:bg-[#E06D2B]/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
