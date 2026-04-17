import { CodeBlock, Endpoint, Section } from "../ApiDocsParts";

/** /ws/client — authenticated bidirectional channel (snapshot + market value frames inbound, position broadcasts outbound). */
export function ClientWebSocketSection() {
  return (
    <Section id="client-ws" title="Client WebSocket">
      <p>
        The <code className="text-mm-accent">/ws/client</code> endpoint is
        the <strong>authenticated bidirectional channel</strong> between your
        server and the Posit engine. It combines <strong>inbound snapshot
        ingestion</strong> with <strong>outbound position broadcasts</strong>
        on a single connection.
      </p>

      <Endpoint
        method="WS"
        path="/ws/client"
        description="Authenticated data exchange channel. Requires API key and (optionally) IP whitelisting."
      >
        <p className="font-medium text-mm-text">Authentication:</p>
        <ul className="list-inside list-disc space-y-1 pl-1">
          <li>
            Pass your API key as a query parameter{" "}
            <code>?api_key=YOUR_KEY</code> or as the{" "}
            <code>X-API-Key</code> header during the handshake.
          </li>
          <li>
            If the server has <code>CLIENT_WS_ALLOWED_IPS</code> configured,
            your source IP must be on the whitelist.
          </li>
          <li>
            TLS is terminated at the infrastructure layer — always use{" "}
            <code>wss://</code> in production.
          </li>
        </ul>

        <p className="font-medium text-mm-text">Inbound — Snapshot frame (you → server):</p>
        <p>
          Send JSON text frames containing snapshot rows. Each frame must
          include a <code>seq</code> (sequence number) which is echoed back
          in the ACK so you can correlate responses. Frames without a{" "}
          <code>type</code> field are treated as snapshot frames (backwards
          compatible).
        </p>
        <CodeBlock>{`{
  "seq": 1,
  "stream_name": "__test__",
  "rows": [
    {
      "timestamp": "2026-01-15T12:00:00",
      "raw_value": 0.55,
      "symbol": "BTC"
    }
  ]
}`}</CodeBlock>

        <p className="font-medium text-mm-text">Inbound — Market value frame (you → server):</p>
        <p>
          Push aggregate market vol for one or more symbol/expiry pairs.
          Set <code>type</code> to <code>"market_value"</code> and include
          an <code>entries</code> array. Writes go to the market value
          store; no immediate pipeline rerun — the dirty-flag coalescing
          picks it up on the next tick.
        </p>
        <CodeBlock>{`{
  "type": "market_value",
  "seq": 2,
  "entries": [
    { "symbol": "BTC", "expiry": "2026-01-02T00:00:00", "total_vol": 0.55 },
    { "symbol": "ETH", "expiry": "2026-01-02T00:00:00", "total_vol": 0.72 }
  ]
}`}</CodeBlock>

        <p className="font-medium text-mm-text">ACK response:</p>
        <p>
          Both frame types receive the same ACK shape.{" "}
          <code>rows_accepted</code> reflects the number of snapshot rows
          or market value entries accepted.
        </p>
        <CodeBlock>{`{
  "type": "ack",
  "seq": 1,
  "rows_accepted": 1,
  "pipeline_rerun": false
}`}</CodeBlock>

        <p className="font-medium text-mm-text">Error response:</p>
        <CodeBlock>{`{
  "type": "error",
  "seq": 1,
  "detail": "Stream not found: 'bad_name'"
}`}</CodeBlock>

        <p className="font-medium text-mm-text">Outbound (server → you):</p>
        <p>
          Position broadcasts arrive automatically at the engine tick interval
          (~2 s). The payload shape is identical to the{" "}
          <code>/ws</code> stream documented above — an object with{" "}
          <code>streams</code>, <code>context</code>, <code>positions</code>,
          and <code>updates</code> arrays.
        </p>
      </Endpoint>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
        <p className="text-xs font-semibold text-emerald-400">
          Quick test
        </p>
        <p>
          A pre-configured{" "}
          <code className="text-emerald-300">__test__</code> stream is
          always available. See the{" "}
          <a href="#quickstart" className="underline text-emerald-400 hover:text-emerald-300">
            Quickstart
          </a>{" "}
          section for a complete send & receive walkthrough.
        </p>
      </div>
    </Section>
  );
}
