import { CodeBlock, Endpoint, Section } from "../ApiDocsParts";

/** /ws — read-only pipeline position broadcast. */
export function PublicWebSocketSection() {
  return (
    <Section id="websocket" title="WebSocket Stream">
      <Endpoint method="WS" path="/ws" description="Real-time position output stream. The server pushes a JSON payload on every engine tick.">
        <p>
          <strong className="text-mm-text">Connection:</strong> Standard
          WebSocket handshake. No authentication headers required in the
          current version. On connect, the server immediately sends the
          most recent payload (if available).
        </p>
        <p>
          <strong className="text-mm-text">Tick behavior:</strong> The
          server broadcasts at a fixed interval (default 2 s). In
          development mode it steps through historical timestamps; in
          production it matches wall-clock time.
        </p>
        <p className="font-medium text-mm-text">Payload shape:</p>
        <CodeBlock>{`{
  "streams": [
    {
      "id": "stream-0",
      "name": "deribit_btc_vol",
      "status": "ONLINE",
      "lastHeartbeat": 1710000000000
    }
  ],
  "context": {
    "lastUpdateTimestamp": 1710000000000
  },
  "positions": [
    {
      "symbol": "BTC",
      "expiry": "28MAR25",
      "edge": 0.001234,
      "smoothedEdge": 0.001100,
      "variance": 0.045000,
      "smoothedVar": 0.044500,
      "desiredPos": 150.00,
      "rawDesiredPos": 155.00,
      "currentPos": 0.0,
      "totalFair": 0.550000,
      "totalMarketFair": 0.540000,
      "changeMagnitude": 12.50,
      "updatedAt": 1710000000000
    }
  ],
  "updates": [
    {
      "id": "update-3-BTC-28MAR25",
      "symbol": "BTC",
      "expiry": "28MAR25",
      "oldPos": 100.00,
      "newPos": 150.00,
      "delta": 50.00,
      "reason": "",
      "timestamp": 1710000000000
    }
  ]
}`}</CodeBlock>
        <p>
          <strong className="text-mm-text">Field notes:</strong>
        </p>
        <ul className="list-inside list-disc space-y-1 pl-1">
          <li><code>streams</code> — Active data stream heartbeats</li>
          <li><code>context</code> — Current engine state and operating space</li>
          <li><code>positions</code> — Full position grid for the current tick</li>
          <li>
            <code>updates</code> — Position-change cards emitted when the
            desired position shifts significantly between ticks
          </li>
          <li>All timestamps are Unix milliseconds (UTC)</li>
        </ul>
      </Endpoint>
    </Section>
  );
}
