import { CodeBlock, Endpoint, Section } from "./ApiDocsParts";
import { AuthSection } from "./apiDocs/AuthSection";
import { BlocksSection } from "./apiDocs/BlocksSection";
import { ClientWebSocketSection } from "./apiDocs/ClientWebSocketSection";
import { MarketValuesSection } from "./apiDocs/MarketValuesSection";
import { PublicWebSocketSection } from "./apiDocs/PublicWebSocketSection";
import { QuickstartSection } from "./apiDocs/QuickstartSection";
import { SdkSection } from "./apiDocs/SdkSection";

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "auth", label: "Authentication" },
  { id: "sdk", label: "Python SDK" },
  { id: "quickstart", label: "Quickstart" },
  { id: "workflow", label: "Integration Workflow" },
  { id: "websocket", label: "WebSocket Stream" },
  { id: "client-ws", label: "Client WebSocket" },
  { id: "health", label: "Health" },
  { id: "streams", label: "Stream Management" },
  { id: "snapshots", label: "Snapshot Ingestion" },
  { id: "blocks", label: "Blocks" },
  { id: "market-values", label: "Market Values" },
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
            The Posit server exposes a <strong>REST API</strong> for configuration
            and data ingestion, plus a <strong>WebSocket stream</strong> for
            real-time position output. All REST endpoints live under the{" "}
            <code className="text-mm-accent">/api</code> prefix. The WebSocket
            endpoint is at <code className="text-mm-accent">/ws</code>.
          </p>
          <p>
            The base URL is determined by your deployment (e.g.{" "}
            <code>https://posit-admin.up.railway.app</code>). Set the{" "}
            <code>VITE_API_BASE</code> environment variable to override.
          </p>
          <p>
            All request and response bodies use <strong>JSON</strong>.
            Include <code>Content-Type: application/json</code> on every
            POST/PATCH/PUT request. All{" "}
            <code className="text-mm-accent">/api/*</code> routes except{" "}
            <code>/api/health</code> require an API key — see the{" "}
            <a href="#auth" className="underline text-mm-accent hover:opacity-80">
              Authentication
            </a>{" "}
            section.
          </p>
        </Section>

        <AuthSection />

        <SdkSection />

        <QuickstartSection />

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
              columns. Optionally include <code>market_value</code> per row
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
            <code>market_value</code> field in snapshot rows.
          </p>
        </Section>

        <PublicWebSocketSection />

        <ClientWebSocketSection />

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
              provided by your Posit account representative. Once configured, the
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

        <BlocksSection />

        <MarketValuesSection />

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
