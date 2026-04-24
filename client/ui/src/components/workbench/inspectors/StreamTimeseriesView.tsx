/**
 * Shared time-series rendering primitives — chart + keys + the convenience
 * wrapper `StreamTimeseriesView` that composes both.
 *
 * OpinionInspector reaches for `<StreamTimeseriesChart>` directly and
 * renders its own combined per-dim table (mixing the chart's colour map
 * with the pipeline's fair / variance values) so the legend and the blocks
 * list don't duplicate on screen. StreamInspector still renders the full
 * `<StreamTimeseriesView>` which stacks chart + default `<StreamKeyList>`.
 */
import ReactECharts from "echarts-for-react";
import { BLOCK_COLORS } from "../../PipelineChart/chartOptions";
import type { StreamTimeseriesState } from "../../../hooks/useStreamTimeseries";
import { useStreamTimeseries } from "../../../hooks/useStreamTimeseries";

// Fixed chart height so the legend list below can take whatever room it
// needs without compressing the chart to unreadable thickness.
const CHART_HEIGHT_PX = 320;

export function StreamTimeseriesView({ streamName }: { streamName: string }) {
  const state = useStreamTimeseries(streamName);
  if (state.error) return <ErrorCard message={state.error} />;
  if (state.data && state.data.series.length > 0) {
    return (
      <>
        <StreamTimeseriesChart state={state} />
        <StreamKeyList state={state} />
      </>
    );
  }
  if (state.loading) return <LoadingLine />;
  if (state.data) return <EmptyRegistryCard status={state.data.status} />;
  return <p className="text-[11px] text-mm-text-dim">No data.</p>;
}

/**
 * Chart-only renderer. Use with `useStreamTimeseries` when you want to
 * compose a custom legend/list (see OpinionInspector).
 */
export function StreamTimeseriesChart({ state }: { state: StreamTimeseriesState }) {
  if (state.error) return <ErrorCard message={state.error} />;
  if (state.loading && !state.data) return <LoadingLine />;
  if (!state.data || state.data.series.length === 0) {
    if (state.data) return <EmptyRegistryCard status={state.data.status} />;
    return <LoadingLine />;
  }
  return (
    <div className="shrink-0" style={{ height: CHART_HEIGHT_PX }}>
      {state.chartOption ? (
        <ReactECharts
          option={state.chartOption}
          notMerge
          lazyUpdate
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      ) : (
        <p className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
          All series hidden — toggle one below to show.
        </p>
      )}
    </div>
  );
}

/**
 * Default key-list — colour swatch + dim label, click to hide/show the
 * corresponding chart series. OpinionInspector replaces this with its own
 * combined-with-blocks table; StreamInspector continues to use it.
 */
export function StreamKeyList({ state }: { state: StreamTimeseriesState }) {
  if (!state.data || state.data.series.length === 0) return null;
  return (
    <ul className="flex shrink-0 flex-col gap-0.5">
      <li className="flex items-center justify-between px-1 pb-1 text-[9px] uppercase tracking-wider text-mm-text-dim">
        <span>Keys ({state.data.series.length})</span>
        <span className="text-mm-text-subtle">click to toggle</span>
      </li>
      {state.data.series.map((s) => {
        const id = state.keyId(s.key);
        const hidden = state.hiddenKeys.has(id);
        const color = state.colorByKey.get(id) ?? BLOCK_COLORS[0];
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => state.toggleKey(id)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-[10px] transition-colors ${
                hidden
                  ? "border-transparent bg-transparent text-mm-text-subtle hover:bg-black/[0.03]"
                  : "border-black/[0.06] bg-white/45 text-mm-text hover:bg-white/70"
              }`}
              aria-pressed={!hidden}
            >
              <span
                className="inline-block h-[3px] w-4 shrink-0 rounded-full"
                style={{ backgroundColor: hidden ? "rgba(0,0,0,0.18)" : color }}
              />
              <span className={`flex-1 truncate font-mono ${hidden ? "line-through" : ""}`}>
                {state.formatKey(s.key)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function LoadingLine() {
  return <p className="text-[11px] text-mm-text-dim">Loading stream history…</p>;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
      {message}
    </p>
  );
}

function EmptyRegistryCard({ status }: { status: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-black/[0.06] bg-white/40 p-3 text-[11px] text-mm-text-dim">
      <p className="font-semibold text-mm-text">No snapshot rows in the registry.</p>
      <p>
        The stream is registered (<span className="font-mono text-mm-text">{status}</span>) but its
        <span className="font-mono text-mm-text"> snapshot_rows</span> array is empty. Push rows via the SDK
        (<span className="font-mono text-mm-text">POST /api/snapshots</span>) or, for manual blocks, edit
        them via the Block Inspector when you focus a block.
      </p>
      <p className="text-[10px] text-mm-text-subtle">
        Tip: cells in the position grid use the cached pipeline output, which can outlive a registry reset —
        so values appear there even when the registry is empty.
      </p>
    </div>
  );
}
