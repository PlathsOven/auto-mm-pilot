# User Journey

Who uses this product, what they do with it, and what must never break.

## Background

The first APT customer is the head of the crypto options market-making desk at a mid-sized crypto trading firm. He comes from a quant background — technically sophisticated, fluent in math and vol surfaces — but has never been a positional trader. He wanted to hire a senior trader to manage leftover positions after the desk's short-term alphas, because 24/7 coverage of the crypto cycle is unsustainable for one person. APT is the automated version of that trader.

APT does not trade for him. It provides the **framework** by which a positional trader thinks — Edge × Bankroll / Variance — and gives him the platform to feed data and opinions into that framework. Over time, using APT teaches the customer to reason about positions the way a senior trader would: which streams are driving edge, how variance tempers sizing, and why a position changed overnight while he was asleep.

## Personas

### Primary: Quant desk head running a 24/7 crypto options book
- **Background:** Quantitative, not a trader. Understands vol surfaces, IV percentiles, and funding rates fluently. Lacks the positional trading intuition that comes from years of managing a book through cycles.
- **Pain:** He has been managing positions himself around the clock. The desk is losing on leftover positions after short-term alphas expire, because there is no systematic framework for long-term position management. He cannot hire a senior trader, so he needs the framework itself.
- **What he wants:** "Tell me what position to put on, and why." He wants to feed his data and views into a system that synthesises them into a desired position he can act on manually.
- **Time horizon:** Minutes to hours for a position adjustment decision. Does not wait for batch jobs.
- **Needs:**
  - Live pipeline state always visible (WS connection indicator, last tick timestamp).
  - One-click investigation: click a cell in the desired position grid, get a plain-language explanation streaming back from the LLM layer.
  - Trust that the numbers match what the engine actually computed. No silent staleness.
  - Sub-200ms responsiveness for UI interactions on received data.
  - The LLM to explain *why* — not just "your desired position is X" but "your desired position is X because stream Y drove edge up while variance stayed flat, meaning your confidence-weighted view is stronger than the market's pricing."

### Secondary: Non-technical operator deploying the terminal
- **Role:** The product builder. Deploys and maintains the system. Manages env vars via Railway and Vercel dashboards. Does not read code day-to-day but understands the architecture.
- **Touches:** `./start.sh` locally, Railway dashboard for server, Vercel dashboard for client, an `.env` file with two or three keys.
- **Needs:**
  - A README that walks through local dev + production deploy in one place.
  - Troubleshooting for the common failure modes (missing API key, CORS, wrong `VITE_API_BASE`).
  - A clear "is the server healthy?" check (`/api/health`).

## Core Flows

### Flow 1: Steady-State Monitoring (primary — the 24/7 value)

This is the daily loop. The customer opens APT, sees where his positions should be, and acts.

1. **Connect.** Opens terminal → WS handshake to `/ws` → desired position grid populates live → updates feed shows tick-by-tick changes with stream attribution.
2. **Notice a change.** A desired position has moved since he last checked — the grid highlights it, the updates feed attributes the move to a specific stream or block.
3. **Investigate.** Clicks the cell → context (symbol, expiry, current edge, variance breakdown) is posted to LlmChat → @APT investigation streams back via SSE, walking through the reasoning chain: what drove the change, which stream, how fair value and market-implied compare, directional effect on position.
4. **Learn.** Over time, the investigation conversations teach the customer to think in Edge/Variance/Bankroll terms — building the positional intuition he currently lacks.
5. **Reposition manually.** He decides whether to act and executes the trade himself on his firm's execution platform. APT advises; it does not execute.

### Flow 2: Onboarding a New Data Stream (setup — LLM-guided)

The customer has a new data source available — realized vol from a new provider, a funding rate feed, etc. He wants it reflected in his desired positions.

1. **Ask the LLM.** He describes the data stream to the APT LLM: what it measures, its units, how frequently it updates.
2. **LLM guides configuration.** The LLM asks targeted questions to determine the `StreamConfig` parameters: target-space mapping (scale/offset/exponent), temporal position (static vs. shifting), annualized vs. discrete, fixed vs. relative, decay shape, aggregation logic, confidence weight (`var_fair_ratio`). Critically, the LLM explains *why* each parameter matters in terms of the Edge/Variance framework — this is the "teaching" layer.
3. **Quick-start with a manual block (optional).** Before the data stream is properly connected, the customer can capture its current value as a manual block (`POST /api/blocks`). This immediately reflects the data source in his desired positions without requiring the full adapter/ingestion pipeline. It is a snapshot, not a live feed.
4. **LLM creates the stream.** When the customer is ready to connect the live feed, the LLM creates the stream definition. The customer then sends data to the open stream endpoint.
5. **Review impact.** The customer opens the Pipeline Chart and Block Configuration panel to see how the new stream's blocks change edge, variance, and desired positions across symbols and expiries.
6. **Iterate.** If the impact looks wrong — positions moved too much, or not enough — he adjusts parameters (confidence weight, decay, scale) with LLM guidance and reviews again.

### Flow 3: Registering an Opinion (setup — LLM-guided)

The customer has a discretionary view — "I think ETH vol is going to spike around the Pectra upgrade" — and wants it reflected in his positions.

1. **Ask the LLM.** He states his opinion in natural language.
2. **LLM translates to parameters.** The LLM asks clarifying questions: What magnitude? Over what time window? How confident are you? Should it decay as the event passes? The LLM maps the answers to manual block parameters (size, temporal position, decay, var_fair_ratio).
3. **Create the manual block.** The LLM creates a manual block reflecting the opinion. The customer sees it appear in the Block Configuration panel.
4. **Review impact.** Same as Flow 2, step 5 — the customer checks how the opinion changes his desired positions.
5. **Adjust or remove.** If the view changes or the event passes, the customer updates or removes the manual block.

### Flow 4: Operator Deployment

1. **Deploy the server.** Push to main → Railway auto-deploys from `Procfile` → operator adds `OPENROUTER_API_KEY` + `APT_MODE` env vars → clicks "Generate Domain" in Railway → verifies `/api/health` returns `{"status": "ok"}`.
2. **Deploy the client.** Push to main → Vercel auto-deploys from `client/ui/vercel.json` → operator adds `VITE_API_BASE=https://<railway-domain>` env var → opens the Vercel URL → confirms the CONNECTED indicator turns green.

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
