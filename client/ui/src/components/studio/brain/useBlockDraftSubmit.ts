import { useCallback, useState } from "react";
import {
  createManualBlock,
  updateBlock,
  type ManualBlockPayload,
  type UpdateBlockPayload,
} from "../../../services/blockApi";
import { NUMERIC_RE, type Draft, type DrawerMode } from "./blockDrawerState";

/**
 * Submit hook for ``BlockDrawer`` — owns ``submitting`` + ``error`` state
 * and turns a ``Draft`` into a POST or PATCH against ``/api/blocks``.
 *
 * On success it fires ``onSaved()`` then ``onClose()``.  On failure it
 * stores the error message so the drawer can render it.
 */
export function useBlockDraftSubmit(
  mode: DrawerMode,
  onSaved: () => void,
  onClose: () => void,
) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (draft: Draft) => {
      setSubmitting(true);
      setError(null);
      try {
        const key_cols = draft.key_cols_raw
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);

        // Strip _key, coerce numeric cells, omit empty.
        const snapshot_rows = draft.snapshot_rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const h of draft.snapshot_headers) {
            const cell = String(r[h] ?? "");
            if (cell === "") continue;
            out[h] = NUMERIC_RE.test(cell) ? parseFloat(cell) : cell;
          }
          return out;
        });

        const blockConfig = {
          annualized: draft.block.annualized,
          size_type: draft.block.size_type,
          aggregation_logic: draft.block.aggregation_logic,
          temporal_position: draft.block.temporal_position,
          decay_end_size_mult: draft.block.decay_end_size_mult,
          decay_rate_prop_per_min: draft.block.decay_rate_prop_per_min,
          decay_profile: "linear" as const,
          var_fair_ratio: draft.block.var_fair_ratio,
        };

        if (mode === "create") {
          const payload: ManualBlockPayload = {
            stream_name: draft.stream_name.trim(),
            key_cols: key_cols.length > 0 ? key_cols : undefined,
            scale: draft.scale,
            offset: draft.offset,
            exponent: draft.exponent,
            block: blockConfig,
            snapshot_rows,
            space_id: draft.space_id.trim() || undefined,
          };
          await createManualBlock(payload);
        } else {
          const payload: UpdateBlockPayload = {
            scale: draft.scale,
            offset: draft.offset,
            exponent: draft.exponent,
            block: blockConfig,
            snapshot_rows,
          };
          await updateBlock(draft.stream_name, payload);
        }

        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [mode, onSaved, onClose],
  );

  return { submitting, error, submit, clearError: () => setError(null) };
}
