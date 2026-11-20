import { useState, type FormEvent } from 'react';
import {
  Check,
  History,
  PackagePlus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  addInventoryItem,
  deleteInventoryItem,
  updateInventoryItem,
} from '../services/firestoreService';
import {
  FIELD_LIMITS,
  INVENTORY_CATEGORIES,
  type InventoryCategory,
  type InventoryItem,
  type InventoryTransaction,
} from '../types';

interface MyKitchenViewProps {
  uid: string;
  buddyName: string;
  inventory: InventoryItem[];
  transactions: InventoryTransaction[];
}

const QUICK_INDIAN_STAPLES: {
  name: string;
  quantity: string;
  category: InventoryCategory;
  isRegular: boolean;
}[] = [
  { name: 'Potato (Aloo)', quantity: '500g', category: 'Vegetables', isRegular: false },
  { name: 'Onion (Pyaaz)', quantity: '4 pieces', category: 'Vegetables', isRegular: true },
  { name: 'Tomato (Tamatar)', quantity: '4 pieces', category: 'Vegetables', isRegular: false },
  { name: 'Rice (Chawal)', quantity: '1kg', category: 'Rice', isRegular: true },
  { name: 'Wheat Flour (Atta)', quantity: '1kg', category: 'Grains', isRegular: true },
  { name: 'Cooking Oil (Tel)', quantity: '500ml', category: 'Other', isRegular: true },
  { name: 'Salt (Namak)', quantity: '500g', category: 'Spices', isRegular: true },
  { name: 'Turmeric (Haldi)', quantity: '100g', category: 'Spices', isRegular: true },
  { name: 'Cumin (Jeera)', quantity: '100g', category: 'Spices', isRegular: true },
];

export function MyKitchenView({
  uid,
  buddyName,
  inventory,
  transactions,
}: MyKitchenViewProps) {
  const [activeTab, setActiveTab] = useState<'inventory' | 'history'>('inventory');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState<InventoryCategory>('Vegetables');
  const [isRegular, setIsRegular] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showStapleConfirm, setShowStapleConfirm] = useState(false);
  const [selectedStaples, setSelectedStaples] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(QUICK_INDIAN_STAPLES.map((s) => [s.name, true])),
  );
  const [seeding, setSeeding] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState('');

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !quantity.trim() || adding) return;
    setAdding(true);
    try {
      await addInventoryItem(uid, {
        name: name.trim(),
        quantity: quantity.trim(),
        category,
        isRegular,
        isAvailable,
      });
      setName('');
      setQuantity('');
      setIsRegular(false);
      setIsAvailable(true);
    } finally {
      setAdding(false);
    }
  }

  async function handleConfirmStaples() {
    setSeeding(true);
    try {
      for (const item of QUICK_INDIAN_STAPLES) {
        if (selectedStaples[item.name]) {
          await addInventoryItem(uid, {
            ...item,
            isAvailable: true,
          });
        }
      }
      setShowStapleConfirm(false);
    } finally {
      setSeeding(false);
    }
  }

  async function handleSaveQty(item: InventoryItem) {
    if (!editingQty.trim()) return;
    await updateInventoryItem(uid, item.id, { quantity: editingQty.trim() });
    setEditingId(null);
  }

  const filtered = inventory.filter((item) => {
    const label = (item.displayName || item.name).toLowerCase();
    const matchesCat = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch = label.includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const inStockCount = inventory.filter(
    (i) => i.isAvailable && (i.numericQuantity === undefined || i.numericQuantity > 0),
  ).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A2421]">
            My Kitchen
          </h1>
          <p className="text-sm text-[#576560] mt-1">
            Live kitchen stock shared with {buddyName}.{' '}
            <span className="font-mono tabular-nums text-[#1B4D3E] font-semibold">
              {inStockCount} in stock
            </span>{' '}
            · {inventory.length} tracked
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-[#F3EFE6] rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'inventory' ? 'bg-white text-[#1A2421] shadow-xs' : 'text-[#576560]'
              }`}
            >
              Stock ({inventory.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'history' ? 'bg-white text-[#1A2421] shadow-xs' : 'text-[#576560]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Activity Log ({transactions.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowStapleConfirm((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-xs font-semibold text-[#1B4D3E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#E06D2B]" />
            Quick-Add Indian Staples
          </button>
        </div>
      </div>

      {/* Explicit User-Confirmed Quick Staples Drawer */}
      {showStapleConfirm && (
        <div className="bg-white border border-[#1B4D3E]/30 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1A2421]">
                Confirm Staples Actually Available at Home
              </h2>
              <p className="text-xs text-[#576560] mt-0.5">
                Uncheck anything you do not currently have before adding to My Kitchen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowStapleConfirm(false)}
              className="p-1.5 rounded-lg text-[#576560] hover:bg-[#F3EFE6] cursor-pointer"
              aria-label="Close staples selector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {QUICK_INDIAN_STAPLES.map((st) => (
              <label
                key={st.name}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-xs cursor-pointer"
              >
                <span className="flex items-center gap-2 font-medium text-[#1A2421]">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedStaples[st.name])}
                    onChange={(e) =>
                      setSelectedStaples((prev) => ({ ...prev, [st.name]: e.target.checked }))
                    }
                    className="rounded border-[#E6E0D3] text-[#1B4D3E]"
                  />
                  {st.name}
                </span>
                <span className="font-mono text-[#576560]">{st.quantity}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowStapleConfirm(false)}
              className="px-4 py-2 rounded-xl border border-[#E6E0D3] text-xs font-semibold text-[#576560] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={seeding}
              onClick={handleConfirmStaples}
              className="px-5 py-2 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-xs font-semibold cursor-pointer"
            >
              {seeding ? 'Adding Confirmed Staples...' : 'Confirm & Add Selected'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'history' ? (
        <div className="bg-white border border-[#E6E0D3] rounded-2xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#576560]">
              No kitchen transactions recorded yet. Add or use ingredients in Chat, Cooking Mode, or
              My Kitchen to see the audit log here.
            </div>
          ) : (
            <div className="divide-y divide-[#E6E0D3]">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-[#1A2421]">{tx.note}</div>
                    <div className="text-xs text-[#576560] mt-0.5">
                      {tx.actionType.replace(/_/g, ' ')} · Source: {tx.source.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-xs font-semibold text-[#1B4D3E] shrink-0">
                    {tx.previousQuantity} → {tx.newQuantity} {tx.unit}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Add Ingredient Form */}
          <form
            onSubmit={handleAdd}
            className="bg-white border border-[#E6E0D3] rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <h2 className="font-display text-base font-semibold text-[#1A2421]">
              Add Ingredient
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label htmlFor="inv-name" className="block text-xs font-medium text-[#576560] mb-1">
                  Ingredient Name
                </label>
                <input
                  id="inv-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={FIELD_LIMITS.ITEM_NAME_MAX}
                  placeholder="e.g. Aloo, Paneer, Eggs"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                />
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="inv-qty" className="block text-xs font-medium text-[#576560] mb-1">
                  Quantity
                </label>
                <input
                  id="inv-qty"
                  type="text"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  maxLength={FIELD_LIMITS.ITEM_QTY_MAX}
                  placeholder="e.g. 500g, 4 pcs, 1L"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                />
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="inv-cat" className="block text-xs font-medium text-[#576560] mb-1">
                  Category
                </label>
                <select
                  id="inv-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as InventoryCategory)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                >
                  {INVENTORY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex items-end">
                <button
                  type="submit"
                  disabled={adding || !name.trim() || !quantity.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-[#576560]">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="rounded border-[#E6E0D3] text-[#1B4D3E] focus:ring-[#1B4D3E]"
                />
                Currently in stock
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRegular}
                  onChange={(e) => setIsRegular(e.target.checked)}
                  className="rounded border-[#E6E0D3] text-[#1B4D3E] focus:ring-[#1B4D3E]"
                />
                Regular kitchen staple (usually available)
              </label>
            </div>
          </form>

          {/* Search & Category Filter */}
          <div className="space-y-3">
            <div className="relative max-w-sm">
              <Search className="w-4 h-4 text-[#576560] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your kitchen..."
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-[#E6E0D3] bg-white text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {['All', ...INVENTORY_CATEGORIES].map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#1B4D3E] text-white'
                        : 'bg-white border border-[#E6E0D3] text-[#576560] hover:text-[#1A2421]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Inventory List */}
          {inventory.length === 0 ? (
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-10 text-center">
              <PackagePlus className="w-10 h-10 text-[#1B4D3E]/50 mx-auto mb-3" />
              <h3 className="font-display text-lg font-semibold text-[#1A2421] mb-1">
                Your kitchen shelf is empty
              </h3>
              <p className="text-sm text-[#576560] mb-5 max-w-md mx-auto">
                Add what you genuinely have at home—either here, by saying "500g aloo laya" in Chat,
                or by confirming Indian staples below.
              </p>
              <button
                type="button"
                onClick={() => setShowStapleConfirm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#13382D] transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#F4C430]" />
                Select & Confirm Basic Staples
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-[#E6E0D3] rounded-2xl p-8 text-center text-sm text-[#576560]">
              No ingredients match "{search}" in {selectedCategory}.
            </div>
          ) : (
            <div className="bg-white border border-[#E6E0D3] rounded-2xl overflow-hidden">
              <div className="divide-y divide-[#E6E0D3]">
                {filtered.map((item) => (
                  <div
                    key={item.id}
                    className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#FAF8F3]/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`font-medium text-sm ${
                            item.isAvailable ? 'text-[#1A2421]' : 'text-[#576560] line-through'
                          }`}
                        >
                          {item.displayName || item.name}
                        </span>
                      </div>
                      <div className="text-xs text-[#576560] mt-0.5">
                        {item.category}
                        {item.isRegular && ' · Regular staple'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {editingId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingQty}
                            onChange={(e) => setEditingQty(e.target.value)}
                            maxLength={FIELD_LIMITS.ITEM_QTY_MAX}
                            className="w-28 px-2.5 py-1 rounded-lg border border-[#1B4D3E] text-xs font-mono text-[#1A2421]"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveQty(item)}
                            className="p-1.5 rounded-lg bg-[#1B4D3E] text-white cursor-pointer"
                            aria-label="Save quantity"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingQty(item.quantity);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#F3EFE6] hover:bg-[#E6E0D3] text-xs font-mono tabular-nums font-medium text-[#1A2421] cursor-pointer"
                          title="Click to edit quantity"
                        >
                          {item.quantity}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          updateInventoryItem(uid, item.id, { isRegular: !item.isRegular })
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          item.isRegular
                            ? 'bg-[#F4C430]/30 text-[#13382D]'
                            : 'border border-[#E6E0D3] text-[#576560]'
                        }`}
                      >
                        {item.isRegular ? 'Regular' : 'Mark Regular'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateInventoryItem(uid, item.id, { isAvailable: !item.isAvailable })
                        }
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          item.isAvailable
                            ? 'bg-[#1B4D3E]/10 text-[#1B4D3E]'
                            : 'bg-[#E06D2B]/10 text-[#9A3412]'
                        }`}
                      >
                        {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteInventoryItem(uid, item.id)}
                        aria-label={`Remove ${item.displayName || item.name}`}
                        className="p-1.5 rounded-lg text-[#576560] hover:text-[#E06D2B] hover:bg-[#E06D2B]/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
