import { CodeBlock, Collapsible, Section } from "../ApiDocsParts";

/** Python SDK — posit-sdk quickstart and API reference. */
export function SdkSection() {
  return (
    <Section id="sdk" title="Python SDK">
      <p>
        <strong>posit-sdk</strong> is the recommended integration path. It
        wraps all REST endpoints and the <code>/ws/client</code> WebSocket
        in a typed async client — no hand-rolled JSON or reconnect logic
        required.
      </p>

      <p className="font-medium text-mm-text">Install:</p>
      <CodeBlock>{`# From the repo (until published to PyPI)
pip install -e /path/to/posit/sdk/

# Or directly from git
pip install "git+https://github.com/your-org/posit.git#subdirectory=sdk"`}</CodeBlock>

      <p className="font-medium text-mm-text">
        Minimal full-stack example — one script that seeds market reference,
        pushes a stream, and reads positions:
      </p>
      <CodeBlock>{`import asyncio, os
from posit_sdk import PositClient, SnapshotRow, MarketValueEntry

async def main():
    async with PositClient(
        url=os.environ["POSIT_URL"],
        api_key=os.environ["POSIT_API_KEY"],
    ) as client:

        # 1. Register the stream (idempotent; safe on every launch).
        #    exponent=2 routes vol → variance, the pipeline's target space.
        await client.configure_stream_for_variance(
            "rv_btc", key_cols=["symbol", "expiry"],
        )

        # 2. Set bankroll. Kelly sizing reads it on every rerun.
        await client.set_bankroll(1_000_000.0)

        # 3. Feed the aggregate market reference — "market is pricing X vol".
        #    One entry per (symbol, expiry). Must be in place before the
        #    first push, or the zero-edge guard will reject it.
        await client.set_market_values([
            MarketValueEntry(
                symbol="BTC",
                expiry="2026-03-27T00:00:00",
                total_vol=0.70,
            ),
        ])

        # 4. Feed the data stream — one realised-vol reading.
        await client.push_snapshot("rv_btc", [
            SnapshotRow(
                timestamp="2026-01-01T00:00:00",
                raw_value=0.65,
                symbol="BTC",
                expiry="2026-03-27T00:00:00",
            ),
        ])

        # 5. Receive desired positions. edge · bankroll / var per (sym, exp).
        payload = await client.get_positions()
        for pos in payload.positions:
            print(pos.symbol, pos.expiry, round(pos.desired_pos, 2))

asyncio.run(main())`}</CodeBlock>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
        <p className="text-xs font-semibold text-amber-400">
          What this needs to work
        </p>
        <p className="mt-1">
          The three operations above each depend on an implicit piece of
          setup. Miss any and every <code>desired_pos</code> comes back 0 —
          or, for the last one, the server returns{" "}
          <code>422 ZERO_EDGE_BLOCKED</code>:
        </p>
        <ul className="list-inside list-disc space-y-1 pl-1">
          <li>
            <strong>Bankroll must be set.</strong> Kelly sizing is{" "}
            <code>edge · bankroll / var</code>; if bankroll is 0, every
            position is 0.
          </li>
          <li>
            <strong>
              <code>key_cols</code> must include <code>symbol</code> and{" "}
              <code>expiry</code>.
            </strong>{" "}
            The pipeline aggregates blocks per <code>(symbol, expiry)</code>{" "}
            pair; a stream missing either has nowhere to land.
          </li>
          <li>
            <strong>Transform must match your feed's units.</strong>{" "}
            <code>configure_stream_for_variance</code> sets{" "}
            <code>exponent=2</code> for vol feeds (variance is additive; vol
            is not). Use <code>configure_stream_for_linear</code> for
            readings already in target space.
          </li>
          <li>
            <strong>Market values must precede the first push</strong> — or
            the first <code>push_snapshot</code> on a fresh stream is
            rejected with HTTP 422 <code>ZERO_EDGE_BLOCKED</code>. Pass{" "}
            <code>allow_zero_edge=True</code> on{" "}
            <code>push_snapshot</code> to opt out.
          </li>
        </ul>
      </div>

      <Collapsible title="Per-row market_value (alternative to aggregate)">
        <p className="mb-2">
          If the market-implied value is naturally a property of each
          reading (e.g. an ATM IV quote that ships with every realised-vol
          tick), set it on the row instead of seeding the aggregate:
        </p>
        <CodeBlock>{`await client.push_snapshot("rv_btc", [
    SnapshotRow(
        timestamp="2026-01-01T00:00:00",
        raw_value=0.65,
        market_value=0.70,   # per-row override
        symbol="BTC",
        expiry="2026-03-27T00:00:00",
    ),
])`}</CodeBlock>
        <p className="mt-2">
          Per-row values override the aggregate on their own{" "}
          <code>(symbol, expiry)</code>. Pick one path per stream.
        </p>
      </Collapsible>

      <Collapsible title="create_manual_block — event / static position">
        <p className="mb-2">
          Manual blocks represent static positional views (e.g. FOMC event
          impact) that are not backed by a live stream. Each block is tied
          to a stream name that acts as its identifier.
        </p>
        <CodeBlock>{`from posit_sdk import SnapshotRow, BlockConfig

block = await client.create_manual_block(
    "fomc_jun26",
    snapshot_rows=[
        SnapshotRow(
            timestamp="2026-06-11T18:00:00",
            raw_value=0.05,   # expected event vol impact
            symbol="BTC",
            expiry="2026-06-27T00:00:00",
        ),
    ],
    block=BlockConfig(temporal_position="static"),
)
print(block.block_name, block.space_id)`}</CodeBlock>
        <p className="mt-2">
          Delete when the event passes: <code>await client.delete_block("fomc_jun26")</code>
        </p>
      </Collapsible>

      <Collapsible title="Live-streamed positions (WebSocket)">
        <p className="mb-2">
          Pass <code>connect_ws=True</code> to stream position payloads
          instead of polling. <code>positions()</code> is an async
          generator that yields every pipeline broadcast.
        </p>
        <CodeBlock>{`async with PositClient(url=POSIT_URL, api_key=API_KEY, connect_ws=True) as client:
    async for payload in client.positions():
        if payload.transport == "poll":
            # WS dropped; SDK degraded to REST polling. Surface a stale
            # indicator in the UI.
            ...
        for pos in payload.positions:
            print(pos.symbol, pos.expiry, round(pos.desired_pos, 2))`}</CodeBlock>
      </Collapsible>

      <p className="font-medium text-mm-text">Full client API:</p>
      <ul className="list-inside list-disc space-y-1 pl-1">
        <li>
          <code>configure_stream_for_variance</code> /{" "}
          <code>configure_stream_for_linear</code> — idempotent stream
          setup (recommended)
        </li>
        <li>
          <code>upsert_stream</code> / <code>bootstrap_streams</code> —
          custom transforms, atomic multi-stream registration
        </li>
        <li><code>describe_stream</code> / <code>list_streams</code> / <code>delete_stream</code></li>
        <li><code>push_snapshot</code> (WebSocket) · <code>ingest_snapshot</code> (REST)</li>
        <li><code>push_fanned_snapshot</code> — scalar feed fanned across the live universe</li>
        <li><code>get_bankroll</code> / <code>set_bankroll</code></li>
        <li><code>list_market_values</code> / <code>set_market_values</code> / <code>delete_market_value</code> (REST)</li>
        <li><code>push_market_values</code> (WebSocket)</li>
        <li><code>list_blocks</code> / <code>create_manual_block</code> / <code>update_block</code> / <code>delete_block</code></li>
        <li><code>get_positions</code> — one-shot REST · <code>positions()</code> — async generator of live broadcasts</li>
        <li><code>positions_since</code> — replay payloads after a WS gap</li>
        <li><code>diagnose_zero_positions</code> — typed reasons for zero desired positions</li>
        <li><code>events()</code> — structured SDK event stream (fallbacks, zero-edge warnings, reconnects)</li>
      </ul>
    </Section>
  );
}
