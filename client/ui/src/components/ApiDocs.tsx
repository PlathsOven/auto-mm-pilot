import { useState } from "react";

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function Badge({ method }: { method: string }) {
  const color: Record<string, string> = {
    GET: "bg-emerald-500/20 text-emerald-400",
    POST: "bg-sky-500/20 text-sky-400",
    PATCH: "bg-amber-500/20 text-amber-400",
    DELETE: "bg-rose-500/20 text-rose-400",
    WS: "bg-violet-500/20 text-violet-400",
    SSE: "bg-fuchsia-500/20 text-fuchsia-400",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color[method] ?? "bg-mm-border text-mm-text-dim"}`}
    >
      {method}
    </span>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-black/[0.06] bg-mm-bg-deep p-3 text-[11px] leading-relaxed text-mm-text-dim">
      {children.trim()}
    </pre>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-3 border-b border-black/[0.04] pb-1.5 text-sm font-semibold text-mm-accent">
        {title}
      </h2>
      <div className="space-y-3 text-xs leading-relaxed text-mm-text-dim">
        {children}
      </div>
    </section>
  );
}

function Collapsible({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-mm-border/10"
      >
        <span className="text-[11px] font-medium text-mm-text">{title}</span>
        <span className="ml-auto text-[10px] text-mm-text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-black/[0.03] px-3 py-2.5 text-[11px] text-mm-text-dim">
          {children}
        </div>
      )}
    </div>
  );
}

function Endpoint({
  method,
  path,
  description,
  children,
}: {
  method: string;
  path: string;
  description: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-mm-border/10"
      >
        <Badge method={method} />
        <code className="text-[11px] font-medium text-mm-text">{path}</code>
        <span className="ml-auto text-[10px] text-mm-text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {!open && (
        <p className="px-3 pb-2 text-[11px] text-mm-text-dim">{description}</p>
      )}
      {open && (
        <div className="space-y-2 border-t border-black/[0.03] px-3 py-2.5 text-[11px] text-mm-text-dim">
          <p>{description}</p>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "workflow", label: "Integration Workflow" },
  { id: "websocket", label: "WebSocket Stream" },
  { id: "client-ws", label: "Client WebSocket" },
  { id: "health", label: "Health" },
  { id: "streams", label: "Stream Management" },
  { id: "snapshots", label: "Snapshot Ingestion" },
  { id: "bankroll", label: "Bankroll" },
  { id: "llm", label: "LLM Endpoints" },
] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ApiDocs() {
  return (
    <div className="flex h-full overflow-hidden text-mm-text">
      {/* Sidebar nav */}
      <nav className="hidden w-36 shrink-0 overflow-y-auto border-r border-black/[0.04] py-3 pr-2 pl-3 md:block">
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="block rounded px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-accent/10 hover:text-mm-text"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-3">
        {/* ── Overview ─────────────────────────────────── */}
        <Section id="overview" title="Overview">
          <p>
            The APT server exposes a <strong>REST API</strong> for configuration
            and data ingestion, plus a <strong>WebSocket stream</strong> for
            real-time position output. All REST endpoints live under the{" "}
            <code className="text-mm-accent">/api</code> prefix. The WebSocket
            endpoint is at <code className="text-mm-accent">/ws</code>.
          </p>
          <p>
            The base URL is determined by your deployment (e.g.{" "}
            <code>https://apt-admin.up.railway.app</code>). Set the{" "}
            <code>VITE_API_BASE</code> environment variable to override.
          </p>
          <p>
            All request and response bodies use <strong>JSON</strong>.
            Include <code>Content-Type: application/json</code> on every request.
          </p>
        </Section>

        {/* ── Quickstart ───────────────────────────────── */}
        <Section id="quickstart" title="Quickstart — Test Send & Receive">
          <p>
            This walkthrough verifies end-to-end connectivity using the
            pre-configured{" "}
            <code className="text-emerald-300">__test__</code> stream. No
            stream registration or admin setup required.
          </p>
          <p className="font-medium text-mm-text">You will open two connections:</p>
          <ul className="list-inside list-disc space-y-1 pl-1">
            <li>
              <code>/ws/client</code> — authenticated channel to <strong>send</strong> test
              data and receive ACKs
            </li>
            <li>
              <code>/ws</code> — read-only stream to <strong>receive</strong> position
              broadcasts (no auth required)
            </li>
          </ul>

          <div className="mt-3 space-y-3">
            <p className="text-xs font-semibold text-emerald-400">Step 1 — Open the position listener</p>
            <p>
              Connect to the read-only WebSocket. The server pushes a JSON
              payload every ~2 s. Before any data is ingested you will
              receive heartbeat frames with an empty <code>positions</code>{" "}
              array.
            </p>
            <CodeBlock>{`# Python (websockets)
import asyncio, websockets, json

async def listen():
    async with websockets.connect("wss://apt-admin.up.railway.app/ws") as ws:
        async for msg in ws:
            payload = json.loads(msg)
            n = len(payload["positions"])
            ts = payload["context"]["lastUpdateTimestamp"]
            print(f"[{ts}] {n} positions")

asyncio.run(listen())`}</CodeBlock>
            <p>
              In a browser console you can use the native WebSocket API:
            </p>
            <CodeBlock>{`const ws = new WebSocket("wss://apt-admin.up.railway.app/ws");
ws.onmessage = (e) => {
  const d = JSON.parse(e.data);
  console.log(d.context.lastUpdateTimestamp, d.positions.length, "positions");
};`}</CodeBlock>

            <p className="text-xs font-semibold text-emerald-400">Step 2 — Send test data</p>
            <p>
              In a <strong>separate</strong> terminal / script, connect to the
              authenticated client endpoint and push a snapshot frame to the{" "}
              <code>__test__</code> stream.
            </p>
            <CodeBlock>{`# Python (websockets)
import asyncio, websockets, json

API_KEY = "YOUR_KEY"  # must match CLIENT_WS_API_KEY on the server

async def send_test():
    uri = f"wss://apt-admin.up.railway.app/ws/client?api_key={API_KEY}"
    async with websockets.connect(uri) as ws:
        frame = {
            "seq": 1,
            "stream_name": "__test__",
            "rows": [
                {
                    "timestamp": "2026-01-15T12:00:00",
                    "raw_value": 0.55,
                    "symbol": "BTC"
                }
            ]
        }
        await ws.send(json.dumps(frame))
        ack = json.loads(await ws.recv())
        print("ACK:", ack)

asyncio.run(send_test())`}</CodeBlock>
            <p>You should receive:</p>
            <CodeBlock>{`{"type": "ack", "seq": 1, "rows_accepted": 1, "pipeline_rerun": true}`}</CodeBlock>

            <p className="text-xs font-semibold text-emerald-400">Step 3 — Observe positions</p>
            <p>
              Switch back to your <code>/ws</code> listener. After the ACK,
              the engine re-runs and broadcasts positions. You should see the
              <code> positions</code> count flip from 0 to a non-zero value.
            </p>
            <CodeBlock>{`[1710000000000] 0 positions
[1710000002000] 0 positions
[1710000004000] 4 positions   # ← engine produced output`}</CodeBlock>

            <p className="mt-1">
              The <code>__test__</code> stream uses an identity transform
              (scale=1, offset=0, exponent=1) with a default block
              configuration. It accepts rows with <code>timestamp</code>,{" "}
              <code>raw_value</code>, and <code>symbol</code>.
            </p>
          </div>

          <Collapsible title="Complete script — apt_test.py (copy & paste)">
            <p className="mb-2 text-mm-text-dim">
              Single-file script that sends a test snapshot and listens for
              position broadcasts. Requires <code>pip install websockets</code>.
            </p>
            <CodeBlock>{`#!/usr/bin/env python3
"""apt_test.py — Minimal APT send & receive test.

Usage:
    pip install websockets
    python apt_test.py
"""

import asyncio
import json
import websockets

# ── Config ────────────────────────────────────────────────────────────────
HOST = "apt-admin.up.railway.app"
API_KEY = "YOUR_KEY"  # must match CLIENT_WS_API_KEY on the server

SEND_URI = f"wss://{HOST}/ws/client?api_key={API_KEY}"
LISTEN_URI = f"wss://{HOST}/ws"

TEST_FRAME = {
    "seq": 1,
    "stream_name": "__test__",
    "rows": [
        {
            "timestamp": "2026-01-15T12:00:00",
            "raw_value": 0.55,
            "symbol": "BTC",
        }
    ],
}

MAX_TICKS = 5  # how many position broadcasts to print before exiting


# ── Listener (read-only /ws) ──────────────────────────────────────────────
async def listen(started: asyncio.Event) -> None:
    async with websockets.connect(LISTEN_URI) as ws:
        started.set()
        count = 0
        async for msg in ws:
            payload = json.loads(msg)
            ts = payload["context"]["lastUpdateTimestamp"]
            n = len(payload["positions"])
            print(f"  [listen] {ts} — {n} positions")
            count += 1
            if count >= MAX_TICKS:
                break


# ── Sender (authenticated /ws/client) ─────────────────────────────────────
async def send(started: asyncio.Event) -> None:
    await started.wait()  # wait for listener to connect first
    await asyncio.sleep(0.5)
    async with websockets.connect(SEND_URI) as ws:
        print(f"  [send]   sending test frame ...")
        await ws.send(json.dumps(TEST_FRAME))
        ack = json.loads(await ws.recv())
        print(f"  [send]   ACK: {json.dumps(ack)}")


# ── Main ──────────────────────────────────────────────────────────────────
async def main() -> None:
    print(f"Connecting to {HOST} ...\\n")
    started = asyncio.Event()
    listener = asyncio.create_task(listen(started))
    sender = asyncio.create_task(send(started))
    await asyncio.gather(sender, listener)
    print("\\nDone.")


if __name__ == "__main__":
    asyncio.run(main())`}</CodeBlock>
          </Collapsible>
        </Section>

        {/* ── Integration Workflow ─────────────────────── */}
        <Section id="workflow" title="Integration Workflow">
          <p className="text-mm-text">
            Follow these steps to connect a new data source to the engine:
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-mm-text">Register a stream</strong> —{" "}
              <code>POST /api/streams</code> with a unique name and your key
              columns. The stream enters <em>PENDING</em> status.
            </li>
            <li>
              <strong className="text-mm-text">Admin configures the stream</strong> —{" "}
              <code>POST /api/streams/{"{name}"}/configure</code> applies
              the server-side processing configuration. The stream
              moves to <em>READY</em>.
            </li>
            <li>
              <strong className="text-mm-text">Set bankroll</strong> —{" "}
              <code>PATCH /api/config/bankroll</code> with your portfolio
              bankroll value.
            </li>
            <li>
              <strong className="text-mm-text">Ingest snapshots</strong> —{" "}
              <code>POST /api/snapshots</code> with rows containing{" "}
              <code>timestamp</code>, <code>raw_value</code>, and all key
              columns. Optionally include <code>market_price</code> per row
              for market comparison (defaults to <code>raw_value</code> if
              omitted). The engine re-runs automatically after each ingestion.
            </li>
            <li>
              <strong className="text-mm-text">Connect the WebSocket</strong> —{" "}
              Open a connection to <code>/ws</code>. The server pushes position
              updates on every engine tick. The latest payload is sent
              immediately on connect so the UI is never blank.
            </li>
          </ol>
          <p>
            After initial setup, your integration loop is simply:{" "}
            <strong>ingest snapshots → receive positions via WebSocket</strong>.
            Bankroll can be updated at any time; each update triggers a fresh
            engine run. Market pricing is set per-block via the{" "}
            <code>market_price</code> field in snapshot rows.
          </p>
        </Section>

        {/* ── WebSocket Stream ─────────────────────────── */}
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

        {/* ── Client WebSocket ────────────────────────── */}
        <Section id="client-ws" title="Client WebSocket">
          <p>
            The <code className="text-mm-accent">/ws/client</code> endpoint is
            the <strong>authenticated bidirectional channel</strong> between your
            server and the APT engine. It combines <strong>inbound snapshot
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

            <p className="font-medium text-mm-text">Inbound (you → server):</p>
            <p>
              Send JSON text frames containing snapshot rows. Each frame must
              include a <code>seq</code> (sequence number) which is echoed back
              in the ACK so you can correlate responses.
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

            <p className="font-medium text-mm-text">ACK response:</p>
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

        {/* ── Health ───────────────────────────────────── */}
        <Section id="health" title="Health">
          <Endpoint method="GET" path="/api/health" description="Simple liveness check. Returns 200 if the server is running.">
            <p className="font-medium text-mm-text">Response:</p>
            <CodeBlock>{`{ "status": "ok" }`}</CodeBlock>
          </Endpoint>
        </Section>

        {/* ── Stream Management ────────────────────────── */}
        <Section id="streams" title="Stream Management">
          <Endpoint method="POST" path="/api/streams" description="Register a new data stream. It enters PENDING status until an admin configures it.">
            <p className="font-medium text-mm-text">Request body:</p>
            <CodeBlock>{`{
  "stream_name": "deribit_btc_vol",
  "key_cols": ["symbol", "expiry"]
}`}</CodeBlock>
            <p className="font-medium text-mm-text">Response (201):</p>
            <CodeBlock>{`{
  "stream_name": "deribit_btc_vol",
  "key_cols": ["symbol", "expiry"],
  "status": "PENDING"
}`}</CodeBlock>
            <p><strong>409</strong> if a stream with that name already exists.</p>
          </Endpoint>

          <Endpoint method="GET" path="/api/streams" description="List all registered data streams and their configuration status.">
            <p className="font-medium text-mm-text">Response:</p>
            <CodeBlock>{`{
  "streams": [
    {
      "stream_name": "deribit_btc_vol",
      "key_cols": ["symbol", "expiry"],
      "status": "READY"
    }
  ]
}`}</CodeBlock>
            <p>Streams in <em>READY</em> status have been configured by an admin and are eligible for snapshot ingestion.</p>
          </Endpoint>

          <Endpoint method="PATCH" path="/api/streams/{name}" description="Update a stream's name or key columns.">
            <p className="font-medium text-mm-text">Request body (all fields optional):</p>
            <CodeBlock>{`{
  "stream_name": "renamed_stream",
  "key_cols": ["symbol", "expiry", "strike"]
}`}</CodeBlock>
            <p><strong>404</strong> if the stream doesn't exist. <strong>409</strong> if the new name conflicts.</p>
          </Endpoint>

          <Endpoint method="POST" path={"/api/streams/{name}/configure"} description="Admin endpoint: apply server-side processing configuration to move a PENDING stream to READY.">
            <p>
              This endpoint is used by administrators to finalize stream setup.
              The request body contains server-side configuration parameters
              provided by your APT account representative. Once configured, the
              stream moves to <em>READY</em> and can accept snapshot data.
            </p>
          </Endpoint>

          <Endpoint method="DELETE" path="/api/streams/{name}" description="Remove a registered stream. Returns 204 on success.">
            <p><strong>404</strong> if the stream doesn't exist.</p>
          </Endpoint>
        </Section>

        {/* ── Snapshot Ingestion ───────────────────────── */}
        <Section id="snapshots" title="Snapshot Ingestion">
          <Endpoint method="POST" path="/api/snapshots" description="Push data rows for a READY stream. Triggers an engine re-run and WebSocket broadcast.">
            <p className="font-medium text-mm-text">Request body:</p>
            <CodeBlock>{`{
  "stream_name": "deribit_btc_vol",
  "rows": [
    {
      "timestamp": "2025-03-10T12:00:00",
      "raw_value": 0.55,
      "symbol": "BTC",
      "expiry": "2025-03-28T08:00:00"
    }
  ]
}`}</CodeBlock>
            <p>
              Each row <strong>must</strong> include <code>timestamp</code>,{" "}
              <code>raw_value</code>, and every column listed in the stream's{" "}
              <code>key_cols</code>.
            </p>
            <p className="font-medium text-mm-text">Response:</p>
            <CodeBlock>{`{
  "stream_name": "deribit_btc_vol",
  "rows_accepted": 1,
  "pipeline_rerun": true
}`}</CodeBlock>
            <p><strong>404</strong> if stream not found. <strong>422</strong> if rows are missing required columns or the stream is not READY.</p>
          </Endpoint>
        </Section>

        {/* ── Bankroll ─────────────────────────────────── */}
        <Section id="bankroll" title="Bankroll">
          <Endpoint method="PATCH" path="/api/config/bankroll" description="Set the portfolio bankroll. Triggers an engine re-run.">
            <p className="font-medium text-mm-text">Request body:</p>
            <CodeBlock>{`{ "bankroll": 1000000 }`}</CodeBlock>
            <p className="font-medium text-mm-text">Response:</p>
            <CodeBlock>{`{
  "bankroll": 1000000,
  "pipeline_rerun": true
}`}</CodeBlock>
            <p>Bankroll must be greater than 0.</p>
          </Endpoint>
        </Section>

        {/* ── LLM Endpoints ────────────────────────────── */}
        <Section id="llm" title="LLM Endpoints">
          <Endpoint method="SSE" path="/api/investigate" description="Stream an investigation response. Sends tokens as Server-Sent Events.">
            <p className="font-medium text-mm-text">Request (POST):</p>
            <CodeBlock>{`{
  "conversation": [
    { "role": "user", "content": "Why did BTC 28MAR position increase?" }
  ],
  "cell_context": null
}`}</CodeBlock>
            <ul className="list-inside list-disc space-y-1 pl-1">
              <li><code>conversation</code> — OpenAI-style message array</li>
              <li><code>cell_context</code> — Optional context object from a clicked cell or card</li>
            </ul>
            <p className="font-medium text-mm-text">Response (text/event-stream):</p>
            <CodeBlock>{`data: "The"
data: " position"
data: " increased"
data: " because..."
data: [DONE]`}</CodeBlock>
            <p>
              On error, the server emits <code>event: error</code>.
              Returns <strong>503</strong> if the LLM service is unavailable.
            </p>
          </Endpoint>

        </Section>

        <div className="pb-4" />
      </div>
    </div>
  );
}
