// src/store/trendingFashionStore.ts
// REFACTORED: UI-only store - server data now handled by React Query
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Product } from '@/services/products';

export interface TrendingFashionState {
  // UI State only (no server data!)
  activeCategory: string;
  filteredProducts: Product[];
  
  // Actions
  setActiveCategory: (category: string) => void;
  setFilteredProducts: (products: Product[]) => void;
  reset: () => void;
}

const ALL_CATEGORY = 'All';
/** @deprecated persisted legacy default — v2 store resets this */
const LEGACY_DEFAULT_CATEGORY = 'Iro and Buba';

export const useTrendingFashionStore = create<TrendingFashionState>()(
  persist(
    (set) => ({
      // Initial State (UI only)
      activeCategory: ALL_CATEGORY,
      filteredProducts: [],

      // Set active category (user selection)
      setActiveCategory: (category: string) => {
        set({ activeCategory: category || ALL_CATEGORY });
      },

      // Set filtered products (called by component after filtering)
      setFilteredProducts: (products: Product[]) => {
        set({ filteredProducts: products });
      },

      // Reset to initial state
      reset: () => set({
        activeCategory: ALL_CATEGORY,
        filteredProducts: [],
      }),
    }),
    {
      name: 'trending-fashion-ui-store-v2',
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<TrendingFashionState> | undefined;
        const cat = state?.activeCategory?.trim();
        if (!cat || cat === LEGACY_DEFAULT_CATEGORY) {
          return { ...state, activeCategory: ALL_CATEGORY };
        }
        return state;
      },
      partialize: (state) => ({
        // Only persist user's category preference (not products!)
        activeCategory: state.activeCategory,
      }),
    }
  )
);
