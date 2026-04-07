/**
 * Stream Canvas state model.
 *
 * `StreamDraft` is the architect's working copy of a stream definition. Each
 * canvas section reads/writes a slice of this draft. The Preview section
 * computes a "is this fully valid?" flag from the whole draft to gate the
 * Activate button.
 *
 * This file deliberately contains no React imports — the canvas hosts a tiny
 * `useState<StreamDraft>` and passes the draft + an updater down to sections.
 */

export type SectionId =
  | "identity"
  | "data_shape"
  | "target_mapping"
  | "block_shape"
  | "aggregation"
  | "confidence"
  | "preview";

export interface IdentityDraft {
  stream_name: string;
  key_cols: string[];
  description: string;
}

export interface DataShapeDraft {
  /** Raw CSV (or sample rows) the architect pasted. */
  sample_csv: string;
  /** Detected value column name. */
  value_column: string;
}

export interface TargetMappingDraft {
  scale: number;
  offset: number;
  exponent: number;
}

export interface BlockShapeDraft {
  annualized: boolean;
  size_type: "fixed" | "relative";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
}

export interface AggregationDraft {
  aggregation_logic: "average" | "offset";
}

export interface ConfidenceDraft {
  var_fair_ratio: number;
}

export interface StreamDraft {
  identity: IdentityDraft;
  data_shape: DataShapeDraft;
  target_mapping: TargetMappingDraft;
  block_shape: BlockShapeDraft;
  aggregation: AggregationDraft;
  confidence: ConfidenceDraft;
}

export type SectionStatus = "empty" | "draft" | "valid";

export interface SectionState {
  status: SectionStatus;
  message?: string;
}

export const EMPTY_DRAFT: StreamDraft = {
  identity: { stream_name: "", key_cols: ["symbol", "expiry"], description: "" },
  data_shape: { sample_csv: "", value_column: "raw_value" },
  target_mapping: { scale: 1.0, offset: 0.0, exponent: 1.0 },
  block_shape: {
    annualized: true,
    size_type: "fixed",
    temporal_position: "shifting",
    decay_end_size_mult: 1.0,
    decay_rate_prop_per_min: 0.0,
  },
  aggregation: { aggregation_logic: "average" },
  confidence: { var_fair_ratio: 1.0 },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateIdentity(d: IdentityDraft): SectionState {
  if (!d.stream_name && d.key_cols.length === 0) return { status: "empty" };
  if (!d.stream_name) return { status: "draft", message: "Stream name required" };
  if (!/^[a-z0-9_]+$/.test(d.stream_name))
    return { status: "draft", message: "Use snake_case (a-z, 0-9, _)" };
  if (d.key_cols.length === 0)
    return { status: "draft", message: "At least one key column required" };
  return { status: "valid" };
}

export function validateDataShape(d: DataShapeDraft): SectionState {
  if (!d.sample_csv.trim()) return { status: "empty" };
  const lines = d.sample_csv.trim().split("\n");
  if (lines.length < 2)
    return { status: "draft", message: "Paste at least one header + one row" };
  if (!d.value_column)
    return { status: "draft", message: "Value column required" };
  return { status: "valid" };
}

export function validateTargetMapping(d: TargetMappingDraft): SectionState {
  if (!Number.isFinite(d.scale) || d.scale === 0)
    return { status: "draft", message: "Scale must be a non-zero number" };
  if (!Number.isFinite(d.offset))
    return { status: "draft", message: "Offset must be a number" };
  if (!Number.isFinite(d.exponent) || d.exponent === 0)
    return { status: "draft", message: "Exponent must be a non-zero number" };
  return { status: "valid" };
}

export function validateBlockShape(d: BlockShapeDraft): SectionState {
  if (d.decay_end_size_mult < 0)
    return { status: "draft", message: "Decay end size must be ≥ 0" };
  if (d.decay_rate_prop_per_min < 0)
    return { status: "draft", message: "Decay rate must be ≥ 0" };
  return { status: "valid" };
}

export function validateAggregation(_d: AggregationDraft): SectionState {
  return { status: "valid" };
}

export function validateConfidence(d: ConfidenceDraft): SectionState {
  if (!Number.isFinite(d.var_fair_ratio) || d.var_fair_ratio <= 0)
    return { status: "draft", message: "Confidence must be > 0" };
  return { status: "valid" };
}

export function validateAll(draft: StreamDraft): Record<SectionId, SectionState> {
  return {
    identity: validateIdentity(draft.identity),
    data_shape: validateDataShape(draft.data_shape),
    target_mapping: validateTargetMapping(draft.target_mapping),
    block_shape: validateBlockShape(draft.block_shape),
    aggregation: validateAggregation(draft.aggregation),
    confidence: validateConfidence(draft.confidence),
    preview: { status: "valid" },
  };
}

export function isAllValid(states: Record<SectionId, SectionState>): boolean {
  return (
    states.identity.status === "valid" &&
    states.data_shape.status === "valid" &&
    states.target_mapping.status === "valid" &&
    states.block_shape.status === "valid" &&
    states.aggregation.status === "valid" &&
    states.confidence.status === "valid"
  );
}
