import { useEffect, useRef, useState } from "react";
import type { CurrentBlockDecomposition } from "../types";
import { fetchTimeSeries } from "../services/pipelineApi";
import { CONTRIBUTIONS_CACHE_TTL_MS } from "../constants";

export interface StreamContribution {
  blockName: string;
  spaceId: string;
  fair: number;
  marketFair: number;
  variance: number;
  /** edge contribution = fair − market_fair */
  edge: number;
  /** absolute contribution magnitude (for sorting) */
  magnitude: number;
}

interface CacheEntry {
  fetchedAt: number;
  contributions: StreamContribution[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, expiry: string): string {
  return `${symbol}|${expiry}`;
}

function buildContributions(
  blocks: CurrentBlockDecomposition[],
): StreamContribution[] {
  return blocks
    .map<StreamContribution>((b) => {
      const edge = b.fair - b.marketFair;
      return {
        blockName: b.blockName,
        spaceId: b.spaceId,
        fair: b.fair,
        marketFair: b.marketFair,
        variance: b.var,
        edge,
        magnitude: Math.abs(edge),
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude);
}

interface State {
  loading: boolean;
  contributions: StreamContribution[] | null;
  error: string | null;
}

const INITIAL: State = { loading: false, contributions: null, error: null };

/**
 * Fetches per-block fair / variance contributions for a (symbol, expiry) cell
 * via `GET /api/pipeline/timeseries`. Used to populate the Floor hover-card
 * and the Lens decomposition view.
 *
 * Lazy: only fetches when given a non-null cell. Cached for 5 seconds per
 * (symbol, expiry) so a hover that re-mounts the card hits cache. Aborts the
 * in-flight request when the cell changes or component unmounts.
 */
export function useStreamContributions(
  cell: { symbol: string; expiry: string } | null,
): State {
  const [state, setState] = useState<State>(INITIAL);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cell) {
      setState(INITIAL);
      lastKeyRef.current = null;
      return;
    }

    const key = cacheKey(cell.symbol, cell.expiry);
    const now = Date.now();

    // Cache hit
    const cached = cache.get(key);
    if (cached && now - cached.fetchedAt < CONTRIBUTIONS_CACHE_TTL_MS) {
      setState({ loading: false, contributions: cached.contributions, error: null });
      lastKeyRef.current = key;
      return;
    }

    lastKeyRef.current = key;
    const controller = new AbortController();
    setState({ loading: true, contributions: null, error: null });

    fetchTimeSeries(cell.symbol, cell.expiry, null, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (lastKeyRef.current !== key) return;
        const contributions = buildContributions(res.currentDecomposition.blocks);
        cache.set(key, { fetchedAt: Date.now(), contributions });
        setState({ loading: false, contributions, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (lastKeyRef.current !== key) return;
        setState({
          loading: false,
          contributions: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => controller.abort();
  }, [cell?.symbol, cell?.expiry]);

  return state;
}
