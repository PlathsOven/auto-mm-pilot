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

      <p className="font-medium text-mm-text">Quickstart — one stream, live positions:</p>
      <CodeBlock>{`import asyncio
from posit_sdk import PositClient, SnapshotRow, BlockConfig

POSIT_URL = "https://posit-admin.up.railway.app"
API_KEY   = "YOUR_KEY"

async def main():
    async with PositClient(url=POSIT_URL, api_key=API_KEY) as client:

        # 1. Register and configure a stream (one-time setup)
        await client.create_stream("rv_btc", key_cols=["symbol", "expiry"])
        await client.configure_stream(
            "rv_btc",
            scale=1.0,
            block=BlockConfig(aggregation_logic="average", annualized=True),
        )
        await client.set_bankroll(1_000_000)

        # 2. Push data (call this on every new observation)
        ack = await client.push_snapshot(
            "rv_btc",
            rows=[
                SnapshotRow(
                    timestamp="2026-01-15T12:00:00Z",
                    raw_value=0.65,
                    symbol="BTC",
                    expiry="2026-03-28T00:00:00Z",
                ),
            ],
        )
        print(f"Accepted {ack.rows_accepted} rows, rerun={ack.pipeline_rerun}")

        # 3. Receive live positions
        async for payload in client.positions():
            for pos in payload.positions:
                print(pos.symbol, pos.expiry, round(pos.desired_pos, 2))
            break  # remove to stream indefinitely

asyncio.run(main())`}</CodeBlock>

      <Collapsible title="push_market_values — aggregate vol (ATM IV)">
        <p className="mb-2">
          Push the aggregate implied vol for each symbol/expiry pair. The
          engine uses this as the "market is pricing X vol" reference when
          computing edge. Push at the same cadence as your IV data source.
        </p>
        <CodeBlock>{`from posit_sdk import MarketValueEntry

await client.push_market_values([
    MarketValueEntry(symbol="BTC", expiry="2026-03-28T00:00:00Z", total_vol=0.70),
    MarketValueEntry(symbol="ETH", expiry="2026-03-28T00:00:00Z", total_vol=0.85),
])`}</CodeBlock>
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
            timestamp="2026-06-11T18:00:00Z",
            raw_value=0.05,   # expected event vol impact
            symbol="BTC",
            expiry="2026-06-27T00:00:00Z",
        ),
    ],
    block=BlockConfig(temporal_position="static", aggregation_logic="offset"),
)
print(block.block_name, block.space_id)`}</CodeBlock>
        <p className="mt-2">
          Delete when the event passes: <code>await client.delete_block("fomc_jun26")</code>
        </p>
      </Collapsible>

      <Collapsible title="REST-only mode (no WebSocket)">
        <CodeBlock>{`async with PositClient(url=POSIT_URL, api_key=API_KEY, connect_ws=False) as client:
    streams = await client.list_streams()
    for s in streams:
        print(s.stream_name, s.status)`}</CodeBlock>
      </Collapsible>

      <p className="font-medium text-mm-text">Full client API:</p>
      <ul className="list-inside list-disc space-y-1 pl-1">
        <li><code>create_stream / update_stream / configure_stream / delete_stream</code></li>
        <li><code>ingest_snapshot</code> (REST) · <code>push_snapshot</code> (WebSocket)</li>
        <li><code>get_bankroll / set_bankroll</code></li>
        <li><code>list_blocks / create_manual_block / update_block / delete_block</code></li>
        <li><code>list_market_values / set_market_values / delete_market_value</code> (REST)</li>
        <li><code>push_market_values</code> (WebSocket)</li>
        <li><code>positions()</code> — async generator of live <code>PositionPayload</code> broadcasts</li>
      </ul>
    </Section>
  );
}
