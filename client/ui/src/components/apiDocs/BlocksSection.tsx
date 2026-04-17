import { CodeBlock, Endpoint, Section } from "../ApiDocsParts";

/** /api/blocks — block configuration table endpoints. */
export function BlocksSection() {
  return (
    <Section id="blocks" title="Blocks">
      <p>
        Blocks are the engine's unit of computation — each block ties a
        data stream to a set of pipeline parameters (scale, aggregation,
        decay, temporal position). Stream-backed blocks are created
        automatically when a stream is configured and receives snapshot data.
        Manual blocks are created explicitly via <code>POST /api/blocks</code>.
      </p>

      <Endpoint method="GET" path="/api/blocks" description="Return all blocks from the current pipeline run, with computed output values.">
        <p className="font-medium text-mm-text">Response:</p>
        <CodeBlock>{`{
  "blocks": [
    {
      "block_name": "rv_btc",
      "stream_name": "rv_btc",
      "symbol": "BTC",
      "expiry": "2026-03-28T00:00:00",
      "space_id": "shifting",
      "source": "stream",
      "annualized": true,
      "size_type": "fixed",
      "aggregation_logic": "average",
      "temporal_position": "shifting",
      "decay_end_size_mult": 1.0,
      "decay_rate_prop_per_min": 0.0,
      "var_fair_ratio": 1.0,
      "scale": 1.0,
      "offset": 0.0,
      "exponent": 1.0,
      "target_value": 0.65,
      "raw_value": 0.65,
      "fair": 0.65,
      "market_fair": 0.70,
      "var": 0.0042,
      "updated_at": "2026-01-15T12:00:05"
    }
  ]
}`}</CodeBlock>
        <p>
          <code>fair</code>, <code>market_fair</code>, and <code>var</code>{" "}
          reflect the values at the current engine tick. They are{" "}
          <code>null</code> if the pipeline has not run yet.
        </p>
      </Endpoint>

      <Endpoint method="POST" path="/api/blocks" description="Create a manual block — registers a stream, configures it, ingests snapshot rows, and re-runs the pipeline in one call.">
        <p className="font-medium text-mm-text">Request body:</p>
        <CodeBlock>{`{
  "stream_name": "fomc_jun26",
  "key_cols": ["symbol", "expiry"],
  "scale": 1.0,
  "offset": 0.0,
  "exponent": 1.0,
  "block": {
    "annualized": true,
    "size_type": "fixed",
    "aggregation_logic": "offset",
    "temporal_position": "static",
    "decay_end_size_mult": 1.0,
    "decay_rate_prop_per_min": 0.0,
    "decay_profile": "linear",
    "var_fair_ratio": 1.0
  },
  "snapshot_rows": [
    {
      "timestamp": "2026-06-11T18:00:00Z",
      "raw_value": 0.05,
      "symbol": "BTC",
      "expiry": "2026-06-27T00:00:00Z"
    }
  ],
  "space_id": null
}`}</CodeBlock>
        <p>
          <strong>409</strong> if a stream with that name already exists.{" "}
          <strong>422</strong> if snapshot rows are missing required columns
          or the block config is invalid.
        </p>
        <p>
          To delete a manual block, delete its underlying stream:{" "}
          <code>DELETE /api/streams/{"{stream_name}"}</code>
        </p>
      </Endpoint>

      <Endpoint method="PATCH" path="/api/blocks/{name}" description="Update an existing block's engine parameters and/or snapshot data, then re-run the pipeline.">
        <p className="font-medium text-mm-text">Request body (all fields optional):</p>
        <CodeBlock>{`{
  "scale": 2.0,
  "block": {
    "aggregation_logic": "average"
  },
  "snapshot_rows": [
    {
      "timestamp": "2026-01-16T00:00:00Z",
      "raw_value": 0.60,
      "symbol": "BTC",
      "expiry": "2026-03-28T00:00:00Z"
    }
  ]
}`}</CodeBlock>
        <p>
          <strong>404</strong> if the stream doesn't exist.{" "}
          <strong>422</strong> if the stream is not in READY status.
        </p>
      </Endpoint>
    </Section>
  );
}
