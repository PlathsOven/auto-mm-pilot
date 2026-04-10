import { useCallback, useEffect, useState } from "react";
import { fetchMarketPricing, updateMarketPricing } from "../../services/streamApi";

interface PricingRow {
  key: string;
  value: number;
}

/**
 * Market pricing editor lifted from `server/api/admin/index.html`.
 *
 * Each row is a `space_id` → price entry. POST merges new entries; existing
 * entries are preserved unless explicitly overwritten.
 */
export function MarketPricingEditor() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const pricing = await fetchMarketPricing();
      setRows(Object.entries(pricing).map(([key, value]) => ({ key, value })));
    } catch (err) {
      setFeedback({
        type: "err",
        text: `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateRow = (idx: number, patch: Partial<PricingRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const removeRow = (idx: number) =>
    setRows((prev) => prev.filter((_, i) => i !== idx));

  const addRow = () =>
    setRows((prev) => [...prev, { key: `space_${prev.length}`, value: 0 }]);

  const handleSave = async () => {
    const pricing: Record<string, number> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      pricing[k] = r.value;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await updateMarketPricing(pricing);
      setFeedback({
        type: "ok",
        text: `Saved ${Object.keys(pricing).length} space${Object.keys(pricing).length === 1 ? "" : "s"}`,
      });
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-black/[0.08] bg-black/[0.03] p-3">
      <h3 className="mb-2 text-xs font-semibold text-mm-text">Market Pricing</h3>
      <p className="mb-3 text-[10px] text-mm-text-dim">
        Per-space-id reference price used to compute fair-vs-market edge.
      </p>

      {loading ? (
        <p className="text-[10px] text-mm-text-dim">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-mm-text-dim">No pricing entries.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={r.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="space_id"
                className="form-input flex-1 font-mono"
              />
              <input
                type="number"
                step="any"
                value={r.value}
                onChange={(e) => updateRow(i, { value: parseFloat(e.target.value) || 0 })}
                placeholder="0.0"
                className="form-input w-24 font-mono"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="rounded-md p-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-error/10 hover:text-mm-error"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded-md border border-black/[0.06] px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
        >
          + Add space
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleSave}
          className="ml-auto rounded-md bg-mm-accent/20 px-3 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save & re-run"}
        </button>
      </div>

      {feedback && (
        <p
          className={`mt-2 text-[10px] ${
            feedback.type === "ok" ? "text-mm-accent" : "text-mm-error"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
