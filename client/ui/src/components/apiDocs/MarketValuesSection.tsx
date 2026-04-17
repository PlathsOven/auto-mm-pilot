import { CodeBlock, Endpoint, Section } from "../ApiDocsParts";

/** /api/market-values — aggregate market vol CRUD. */
export function MarketValuesSection() {
  return (
    <Section id="market-values" title="Market Values">
      <p>
        Aggregate market vol entries store the "market is pricing X vol" value
        for each symbol/expiry pair. The engine uses these as the{" "}
        <code>market_fair</code> reference when computing edge. Push at the same
        cadence as your implied vol data source, or use the{" "}
        <code>/ws/client</code> market_value frame for lower latency.
      </p>

      <Endpoint method="GET" path="/api/market-values" description="Return all stored aggregate market values.">
        <p className="font-medium text-mm-text">Response:</p>
        <CodeBlock>{`{
  "entries": [
    { "symbol": "BTC", "expiry": "2026-03-28T00:00:00", "total_vol": 0.70 },
    { "symbol": "ETH", "expiry": "2026-03-28T00:00:00", "total_vol": 0.85 }
  ]
}`}</CodeBlock>
      </Endpoint>

      <Endpoint method="PUT" path="/api/market-values" description="Batch-set aggregate market values. Merges with existing entries and sets a dirty flag for a coalesced pipeline rerun on the next tick.">
        <p className="font-medium text-mm-text">Request body:</p>
        <CodeBlock>{`{
  "entries": [
    { "symbol": "BTC", "expiry": "2026-03-28T00:00:00", "total_vol": 0.72 },
    { "symbol": "ETH", "expiry": "2026-03-28T00:00:00", "total_vol": 0.88 }
  ]
}`}</CodeBlock>
        <p>
          <code>total_vol</code> must be &ge; 0. Returns the full updated
          entries list on success.
        </p>
      </Endpoint>

      <Endpoint method="DELETE" path="/api/market-values/{symbol}/{expiry}" description="Remove the aggregate for one symbol/expiry pair.">
        <p className="font-medium text-mm-text">Response (200):</p>
        <CodeBlock>{`{ "deleted": true, "symbol": "BTC", "expiry": "2026-03-28T00:00:00" }`}</CodeBlock>
        <p><strong>404</strong> if no entry exists for that pair.</p>
      </Endpoint>

      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2.5">
        <p className="text-xs font-semibold text-sky-400">REST vs WebSocket</p>
        <p>
          For high-frequency updates, prefer the WebSocket{" "}
          <code>market_value</code> frame (documented in the Client WebSocket
          section) — it skips the HTTP round-trip and uses the same dirty-flag
          coalescing. Use the REST endpoint for initial seeding or
          infrequent updates.
        </p>
      </div>
    </Section>
  );
}
