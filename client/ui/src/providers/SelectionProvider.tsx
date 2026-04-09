import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { BlockRow } from "../types";
import { fetchBlocks } from "../services/blockApi";
import { formatExpiry } from "../utils";
import { POLL_INTERVAL_SELECTION_MS } from "../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectionState {
  /** Currently selected block names */
  selectedBlocks: Set<string>;
  /** The symbol + expiry dimension the selection belongs to */
  selectedDimension: { symbol: string; expiry: string } | null;
}

interface SelectionContextValue extends SelectionState {
  /** Toggle-select a single block (click again to deselect) */
  selectBlock: (blockName: string, symbol: string, expiry: string) => void;
  /** Toggle-select all blocks for a given symbol + expiry dimension */
  selectDimension: (symbol: string, expiry: string) => void;
  /** Clear all selection */
  clearSelection: () => void;
  /** Check if a specific block is selected */
  isBlockSelected: (blockName: string) => boolean;
  /** Check if a dimension (symbol + expiry) is selected */
  isDimensionSelected: (symbol: string, expiry: string) => boolean;
}

const EMPTY_SET = new Set<string>();

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SelectionContext = createContext<SelectionContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise expiry to DDMMMYY for comparison (handles both ISO and already-formatted). */
function normExpiry(expiry: string): string {
  // If it looks like an ISO date, convert it
  if (expiry.includes("T") || expiry.includes("-")) return formatExpiry(expiry);
  return expiry.toUpperCase();
}

function dimKey(symbol: string, expiry: string): string {
  return `${symbol}-${normExpiry(expiry)}`;
}

/** Build index: dimKey → block_name[] */
function buildBlockIndex(blocks: BlockRow[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const b of blocks) {
    const key = dimKey(b.symbol, b.expiry);
    const arr = idx.get(key);
    if (arr) arr.push(b.block_name);
    else idx.set(key, [b.block_name]);
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectionState>({
    selectedBlocks: EMPTY_SET,
    selectedDimension: null,
  });

  // Block index: dimKey → block_name[]
  const blockIndexRef = useRef<Map<string, string[]>>(new Map());

  // Poll fetchBlocks to maintain the block index
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const blocks = await fetchBlocks();
        if (active) blockIndexRef.current = buildBlockIndex(blocks);
      } catch {
        // silent — index stays stale until next successful poll
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_SELECTION_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  const clearSelection = useCallback(() => {
    setState({ selectedBlocks: EMPTY_SET, selectedDimension: null });
  }, []);

  const selectBlock = useCallback(
    (blockName: string, symbol: string, expiry: string) => {
      setState((prev) => {
        // Toggle: if this block is the sole selection, deselect
        if (prev.selectedBlocks.size === 1 && prev.selectedBlocks.has(blockName)) {
          return { selectedBlocks: EMPTY_SET, selectedDimension: null };
        }
        return {
          selectedBlocks: new Set([blockName]),
          selectedDimension: { symbol, expiry: normExpiry(expiry) },
        };
      });
    },
    [],
  );

  const selectDimension = useCallback(
    (symbol: string, expiry: string) => {
      const key = dimKey(symbol, expiry);
      setState((prev) => {
        // Toggle: if same dimension is already selected, deselect
        if (
          prev.selectedDimension &&
          dimKey(prev.selectedDimension.symbol, prev.selectedDimension.expiry) === key
        ) {
          return { selectedBlocks: EMPTY_SET, selectedDimension: null };
        }
        const names = blockIndexRef.current.get(key) ?? [];
        return {
          selectedBlocks: new Set(names),
          selectedDimension: { symbol, expiry: normExpiry(expiry) },
        };
      });
    },
    [],
  );

  const isBlockSelected = useCallback(
    (blockName: string) => state.selectedBlocks.has(blockName),
    [state.selectedBlocks],
  );

  const isDimensionSelected = useCallback(
    (symbol: string, expiry: string) => {
      if (!state.selectedDimension) return false;
      return dimKey(state.selectedDimension.symbol, state.selectedDimension.expiry) === dimKey(symbol, expiry);
    },
    [state.selectedDimension],
  );

  const value = useMemo<SelectionContextValue>(
    () => ({
      ...state,
      selectBlock,
      selectDimension,
      clearSelection,
      isBlockSelected,
      isDimensionSelected,
    }),
    [state, selectBlock, selectDimension, clearSelection, isBlockSelected, isDimensionSelected],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
