import type { StreamDraft } from "../canvasState";
import { EMPTY_DRAFT } from "../canvasState";

export interface StreamTemplate {
  id: string;
  title: string;
  oneLiner: string;
  description: string;
  draft: StreamDraft;
}

/**
 * Quick-start templates for the Studio Stream Library.
 *
 * These pre-fill the Stream Canvas with sensible defaults for common
 * trader theses. They are meant as starting points — the architect always
 * tweaks values before activating.
 */
export const STREAM_TEMPLATES: StreamTemplate[] = [
  {
    id: "rolling_realized_vol",
    title: "Rolling Realized Vol",
    oneLiner: "Last-N-day realized volatility as a fair-value estimate.",
    description:
      "Computes the trailing realized volatility of the underlying and uses it as the fair value for variance pricing. Best when the recent vol regime is informative about the next session.",
    draft: {
      ...EMPTY_DRAFT,
      identity: {
        stream_name: "rolling_realized_vol",
        key_cols: ["symbol", "expiry"],
        description: "Trailing 14-day realized vol as a fair-value anchor.",
      },
      data_shape: {
        sample_csv:
          "timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.74",
        value_column: "raw_value",
      },
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
    },
  },
  {
    id: "scheduled_event",
    title: "Scheduled Event (FOMC / CPI)",
    oneLiner: "Add expected vol around a known macro release.",
    description:
      "Adds a step of variance at a scheduled macro event time, decaying out after the print. Stack as offset on top of the realized-vol baseline.",
    draft: {
      ...EMPTY_DRAFT,
      identity: {
        stream_name: "fomc_event",
        key_cols: ["symbol", "expiry"],
        description: "FOMC announcement vol bump, decays out over 2 hours.",
      },
      data_shape: {
        sample_csv:
          "timestamp,symbol,expiry,raw_value\n2026-03-19T18:00:00Z,BTC,27MAR26,0.05",
        value_column: "raw_value",
      },
      target_mapping: { scale: 1.0, offset: 0.0, exponent: 1.0 },
      block_shape: {
        annualized: true,
        size_type: "fixed",
        temporal_position: "static",
        decay_end_size_mult: 0.0,
        decay_rate_prop_per_min: 0.008,
      },
      aggregation: { aggregation_logic: "offset" },
      confidence: { var_fair_ratio: 2.0 },
    },
  },
  {
    id: "iv_percentile",
    title: "IV Percentile",
    oneLiner: "Mean-reversion signal based on IV percentile rank.",
    description:
      "Maps current IV's percentile rank in its trailing distribution to an expected fair value. High percentile → expect mean reversion lower; low percentile → expect mean reversion higher.",
    draft: {
      ...EMPTY_DRAFT,
      identity: {
        stream_name: "iv_percentile",
        key_cols: ["symbol", "expiry"],
        description: "IV mean-reversion signal from rolling percentile rank.",
      },
      data_shape: {
        sample_csv:
          "timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.65",
        value_column: "raw_value",
      },
      target_mapping: { scale: -0.4, offset: 0.7, exponent: 1.0 },
      block_shape: {
        annualized: true,
        size_type: "fixed",
        temporal_position: "shifting",
        decay_end_size_mult: 1.0,
        decay_rate_prop_per_min: 0.0,
      },
      aggregation: { aggregation_logic: "average" },
      confidence: { var_fair_ratio: 5.0 },
    },
  },
  {
    id: "funding_rate",
    title: "Perp Funding Rate",
    oneLiner: "Use perp funding rate as a directional pressure signal.",
    description:
      "Persistent positive funding implies long pressure / overpriced options. Maps the smoothed funding rate to a directional fair-value adjustment.",
    draft: {
      ...EMPTY_DRAFT,
      identity: {
        stream_name: "perp_funding",
        key_cols: ["symbol", "expiry"],
        description: "Perp funding rate as a directional vol signal.",
      },
      data_shape: {
        sample_csv:
          "timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.0001",
        value_column: "raw_value",
      },
      target_mapping: { scale: 100.0, offset: 0.0, exponent: 1.0 },
      block_shape: {
        annualized: false,
        size_type: "fixed",
        temporal_position: "shifting",
        decay_end_size_mult: 1.0,
        decay_rate_prop_per_min: 0.001,
      },
      aggregation: { aggregation_logic: "offset" },
      confidence: { var_fair_ratio: 8.0 },
    },
  },
  {
    id: "cross_asset_corr",
    title: "Cross-Asset Correlation",
    oneLiner: "Use related-asset moves as a leading indicator.",
    description:
      "Measures the recent correlation-implied move from a related asset (e.g. ETH for BTC vol) and feeds it as an additional fair-value contributor.",
    draft: {
      ...EMPTY_DRAFT,
      identity: {
        stream_name: "cross_asset_corr",
        key_cols: ["symbol", "expiry"],
        description: "Related-asset correlation as a leading fair-value signal.",
      },
      data_shape: {
        sample_csv:
          "timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.62",
        value_column: "raw_value",
      },
      target_mapping: { scale: 1.0, offset: 0.0, exponent: 1.0 },
      block_shape: {
        annualized: true,
        size_type: "relative",
        temporal_position: "shifting",
        decay_end_size_mult: 0.5,
        decay_rate_prop_per_min: 0.0005,
      },
      aggregation: { aggregation_logic: "average" },
      confidence: { var_fair_ratio: 4.0 },
    },
  },
];
