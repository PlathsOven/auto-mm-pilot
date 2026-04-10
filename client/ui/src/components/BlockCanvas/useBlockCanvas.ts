import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  BlockRow,
  BlockTimeSeries,
  PipelineTimeSeriesResponse,
  TimeSeriesDimension,
} from "../../types";
import { fetchBlocks } from "../../services/blockApi";
import { fetchDimensions, fetchTimeSeries } from "../../services/pipelineApi";
import { formatExpiry } from "../../utils";
import { POLL_INTERVAL_TIMESERIES_MS, BLOCK_COLORS } from "../../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasBlock {
  /** Block metadata from /api/blocks */
  meta: BlockRow;
  /** Per-timestamp time-series data from /api/pipeline/timeseries */
  series: BlockTimeSeries | null;
  /** Assigned color from BLOCK_COLORS palette */
  color: string;
  /** Whether this block is editable (manual + not shifting) */
  draggable: boolean;
  /** Whether this block can be resized (manual blocks only) */
  resizable: boolean;
  /** Whether this block can be deleted (manual blocks only) */
  deletable: boolean;
  /** Stacking baselines per timestamp — fair lane */
  fairBaseline: number[];
  /** Stacking baselines per timestamp — var lane */
  varBaseline: number[];
}

export interface CanvasSummary {
  totalFair: number;
  totalVar: number;
  edge: number;
  desiredPosition: number;
}

export interface UseBlockCanvasResult {
  dimensions: TimeSeriesDimension[];
  selected: TimeSeriesDimension | null;
  setSelected: (d: TimeSeriesDimension) => void;
  blocks: CanvasBlock[];
  timestamps: string[];
  summary: CanvasSummary;
  loading: boolean;
  error: string | null;
  /** Server time from the latest timestamp in aggregated data */
  serverNow: string | null;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Stacking computation
// ---------------------------------------------------------------------------

function computeStacking(
  blocks: { meta: BlockRow; series: BlockTimeSeries | null }[],
): { fairBaseline: number[]; varBaseline: number[] }[] {
  // Group by space_id, sort within group by block_name for stable order
  const spaceGroups = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    const sid = b.meta.space_id;
    const arr = spaceGroups.get(sid);
    if (arr) arr.push(i);
    else spaceGroups.set(sid, [i]);
  });

  const result: { fairBaseline: number[]; varBaseline: number[] }[] = blocks.map((b) => {
    const len = b.series?.timestamps.length ?? 0;
    return {
      fairBaseline: new Array(len).fill(0),
      varBaseline: new Array(len).fill(0),
    };
  });

  for (const indices of spaceGroups.values()) {
    // Sort by block_name within space for stable order
    indices.sort((a, b) =>
      blocks[a].meta.block_name.localeCompare(blocks[b].meta.block_name),
    );

    // Separate offset and average blocks
    const offsetIndices = indices.filter(
      (i) => blocks[i].meta.aggregation_logic === "offset",
    );

    // For offset blocks: cumulative stacking
    const len = blocks[indices[0]]?.series?.timestamps.length ?? 0;
    const fairCum = new Array(len).fill(0);
    const varCum = new Array(len).fill(0);

    for (const idx of offsetIndices) {
      const series = blocks[idx].series;
      if (!series) continue;
      for (let t = 0; t < series.timestamps.length; t++) {
        result[idx].fairBaseline[t] = fairCum[t];
        result[idx].varBaseline[t] = varCum[t];
        fairCum[t] += series.fair[t] ?? 0;
        varCum[t] += series.var[t] ?? 0;
      }
    }

    // Average blocks: baseline stays at 0 (they overlap)
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBlockCanvas(
  selectedDimension: { symbol: string; expiry: string } | null,
): UseBlockCanvasResult {
  const [dimensions, setDimensions] = useState<TimeSeriesDimension[]>([]);
  const [selected, setSelected] = useState<TimeSeriesDimension | null>(null);
  const [allBlocks, setAllBlocks] = useState<BlockRow[]>([]);
  const [tsData, setTsData] = useState<PipelineTimeSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  // Fetch dimensions + blocks on mount and poll
  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      try {
        const [dims, blks] = await Promise.all([
          fetchDimensions(controller.signal),
          fetchBlocks(),
        ]);
        if (controller.signal.aborted) return;
        setDimensions(dims);
        setAllBlocks(blks);
        setSelected((prev) => {
          if (!prev && dims.length > 0) return dims[0];
          if (
            prev &&
            !dims.some(
              (d) => d.symbol === prev.symbol && d.expiry === prev.expiry,
            )
          ) {
            return dims.length > 0 ? dims[0] : null;
          }
          return prev;
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_TIMESERIES_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [refreshCounter]);

  // Fetch time series when selection changes
  useEffect(() => {
    if (!selected) {
      setTsData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();

    const doFetch = async () => {
      try {
        const res = await fetchTimeSeries(
          selected.symbol,
          selected.expiry,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setTsData(res);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    doFetch();
    const id = setInterval(doFetch, POLL_INTERVAL_TIMESERIES_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [selected, refreshCounter]);

  // Auto-switch dimension when external selection changes
  useEffect(() => {
    if (!selectedDimension || dimensions.length === 0) return;
    const match = dimensions.find(
      (d) =>
        d.symbol === selectedDimension.symbol &&
        formatExpiry(d.expiry) === selectedDimension.expiry,
    );
    if (
      match &&
      (!selected ||
        match.symbol !== selected.symbol ||
        match.expiry !== selected.expiry)
    ) {
      setSelected(match);
    }
  }, [selectedDimension, dimensions, selected]);

  // Merge blocks + time series, compute stacking
  const { canvasBlocks, timestamps, summary, serverNow } = useMemo(() => {
    if (!tsData || !selected) {
      return {
        canvasBlocks: [] as CanvasBlock[],
        timestamps: [] as string[],
        summary: { totalFair: 0, totalVar: 0, edge: 0, desiredPosition: 0 },
        serverNow: null as string | null,
      };
    }

    // Filter blocks for selected dimension
    const dimBlocks = allBlocks.filter(
      (b) =>
        b.symbol === selected.symbol &&
        (b.expiry === selected.expiry ||
          formatExpiry(b.expiry) === formatExpiry(selected.expiry)),
    );

    // Match block metadata to time-series data
    const merged = dimBlocks.map((meta) => {
      const series =
        tsData.blocks.find((ts) => ts.blockName === meta.block_name) ?? null;
      return { meta, series };
    });

    // Compute stacking baselines
    const baselines = computeStacking(merged);

    // Build canvas blocks
    const canvasBlocks: CanvasBlock[] = merged.map((b, i) => ({
      meta: b.meta,
      series: b.series,
      color: BLOCK_COLORS[i % BLOCK_COLORS.length],
      draggable:
        b.meta.source === "manual" &&
        b.meta.temporal_position !== "shifting",
      resizable: b.meta.source === "manual",
      deletable: b.meta.source === "manual",
      fairBaseline: baselines[i].fairBaseline,
      varBaseline: baselines[i].varBaseline,
    }));

    // Aggregated summary from latest timestamp
    const agg = tsData.aggregated;
    const lastIdx = agg.timestamps.length - 1;
    const summary: CanvasSummary = {
      totalFair: lastIdx >= 0 ? agg.totalFair[lastIdx] : 0,
      totalVar: lastIdx >= 0 ? agg.var[lastIdx] : 0,
      edge: lastIdx >= 0 ? agg.edge[lastIdx] : 0,
      desiredPosition:
        lastIdx >= 0 ? agg.smoothedDesiredPosition[lastIdx] : 0,
    };

    // Server "now" = latest aggregated timestamp
    const serverNow =
      agg.timestamps.length > 0
        ? agg.timestamps[agg.timestamps.length - 1]
        : null;

    return {
      canvasBlocks,
      timestamps: agg.timestamps,
      summary,
      serverNow,
    };
  }, [tsData, allBlocks, selected]);

  return {
    dimensions,
    selected,
    setSelected: useCallback(
      (d: TimeSeriesDimension) => setSelected(d),
      [],
    ),
    blocks: canvasBlocks,
    timestamps,
    summary,
    loading,
    error,
    serverNow,
    refresh,
  };
}
