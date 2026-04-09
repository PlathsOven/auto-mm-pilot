# User Journey

Who uses this product, what they do with it, and what must never break.

## Personas

### Primary: Senior trader on a crypto options MM desk
- **Role:** Runs long-term position management for a 24/7 crypto options book. Lives in the APT terminal during market hours.
- **Numerate but not a developer.** Reads formulas fluently, understands vol surfaces and IV percentiles, but does not edit code. Will not open the DevTools console.
- **Time horizon:** minutes to hours for a position adjustment decision. Does not wait for batch jobs.
- **Needs:**
  - Live pipeline state always visible (WS connection indicator, last tick timestamp).
  - One-click investigation: click a cell in the desired position grid, get a plain-language explanation streaming back from the LLM layer.
  - Trust that the numbers match what the engine actually computed. No silent staleness.
  - Sub-200ms responsiveness for UI interactions on received data.

### Secondary: Non-technical operator deploying the terminal
- **Role:** Deploys the product. Manages env vars via Railway and Vercel dashboards. Does not read code.
- **Touches:** `./start.sh` locally, Railway dashboard for server, Vercel dashboard for client, an `.env` file with two or three keys.
- **Needs:**
  - A README that walks through local dev + production deploy in one place.
  - Troubleshooting for the common failure modes (missing API key, CORS, wrong `VITE_API_BASE`).
  - A clear "is the server healthy?" check (`/api/health`).

## Core Flows

1. **Trader connects.** Opens terminal → WS handshake to `/ws` → desired position grid populates live → updates feed starts showing tick-by-tick changes with stream attribution.
2. **Trader investigates a position.** Clicks a cell in the desired position grid → that cell's context (symbol, expiry, current edge, current variance breakdown) is posted to LlmChat → @APT investigation streams back via SSE → trader reads, decides whether to act.
3. **Trader configures a new stream.** Opens Studio → Stream Library → creates or edits a stream via Stream Canvas (7-section form with LLM co-pilot) → activates → the new stream's blocks start appearing in the pipeline on the next tick.
4. **Operator deploys the server.** Pushes to main → Railway auto-deploys from `Procfile` → operator adds `OPENROUTER_API_KEY` + `APT_MODE` env vars → clicks "Generate Domain" in Railway → verifies `/api/health` returns `{"status": "ok"}`.
5. **Operator deploys the client.** Pushes to main → Vercel auto-deploys from `client/ui/vercel.json` → operator adds `VITE_API_BASE=https://<railway-domain>` env var → opens the Vercel URL → confirms the CONNECTED indicator turns green.

## Invariants (must never break)

- **Never show a raw stack trace to the trader.** Errors in the terminal are rendered as human-readable cards, not Python tracebacks.
- **WS connection state is always visible.** If the WS disconnects, the UI shows it immediately. No silent staleness — if the trader can see numbers, those numbers are from the current tick.
- **Latency budget: <200ms per tick render.** The pipeline tick interval is set by the server; the UI must keep up without dropping frames.
- **`# HUMAN WRITES LOGIC HERE` stubs are visible and untouched.** Agents may add them when generating skeleton code, but never remove existing ones.

## Edge Cases

- **WS disconnect mid-investigation.** The streaming LLM response aborts cleanly, the partial answer is preserved in the chat log, a "disconnected — retry?" affordance appears.
- **Empty stream state on fresh deploy.** Before the operator activates any streams, the pipeline runs against mock scenario data (`APT_MODE=mock`). The grid shows mock positions until `APT_MODE=prod` is set and real streams are configured.
- **Two users editing the same stream config.** Last write wins via `stream_registry.py`; no optimistic locking today. Documented risk — if it becomes a problem, add a version field.
- **OpenRouter down.** The fallback chain tries every configured model in order; if all fail, the LLM feature surfaces an error card in LlmChat but the pipeline keeps running.
