# Spec: Connectors (first connector — Realized Volatility)

**Status:** Draft for review.
**Branch:** Fresh branch from `main` after `PlathsOven/remove-onboarding` merges.
**Owner (first implementer):** Next session.

## Overview

A **Connector** is a server-side pre-built module that turns one shape of raw input (e.g., spot prices) into a form suitable to act as a Data Stream's `raw_value` (e.g., realized volatility). Connectors run on the server, which preserves the Posit IP barrier: the client never sees connector implementations, only the catalog metadata (name, description, input schema, recommended stream defaults).

The first connector is **Realized Volatility** — it consumes spot-price ticks per symbol and produces an annualized-vol `raw_value` per symbol, fanned across every expiry in the dim universe by the existing scalar-snapshot machinery.

This spec also removes the existing `STREAM_TEMPLATES` UI so the Stream Canvas has a single cohesive creation flow.

---

## Requirements

### User stories

- **As a trader**, I want to pick "Realized Vol" from a connector catalog in the Stream Canvas, so I can produce a realized-volatility stream by pushing spot ticks — without implementing the math myself.
- **As a trader**, I want the Anatomy DAG to show the connector upstream of the stream (`spot → Realized Vol connector → RV stream → pipeline`), so the provenance of the `raw_value` is legible at a glance.
- **As an SDK integrator**, I want symmetric ergonomics for connector-fed streams — a `client.push_connector_input(stream_name, rows)` that mirrors `client.push_snapshot()` — so I can wire a spot feed to Posit with one function call per tick.
- **As the product owner**, I want connector math to live in `server/core/` behind the IP barrier, so the transformation algorithm is never exposed client-side.

### Acceptance criteria

**Server / math**
- [ ] `GET /api/connectors` returns a catalog containing one entry (`realized_vol`) with: display name, description, input schema, recommended stream config (scale/offset/exponent + BlockConfig), and user-configurable param schema.
- [ ] `POST /api/streams/{name}/configure` accepts an optional `connector_name`; when set, the stream is marked connector-fed.
- [ ] `POST /api/streams/{name}/connector-input` accepts a batch of input rows and:
  - Validates each row against the connector's input schema (rejects with 422 on mismatch).
  - Updates per-symbol, per-snapshot-length EWMA state.
  - Emits a `SnapshotRow` into the stream's `snapshot_rows` when the `avg_rv` value changes (so the pipeline sees fresh data).
  - Marks pipeline dirty so the WS ticker reruns on its next cadence.
- [ ] `POST /api/snapshots` with a connector-fed stream name returns 409 (`STREAM_IS_CONNECTOR_FED`). `/connector-input` with a user-fed stream returns 409 (`STREAM_IS_NOT_CONNECTOR_FED`).
- [ ] Deleting a connector-fed stream evicts its connector state from memory.
- [ ] Realized-vol math (detailed in **Technical Approach → Algorithm**) produces correct values under analytical test cases.

**SDK**
- [ ] `client.list_connectors()` returns the catalog (typed Pydantic models).
- [ ] `client.push_connector_input(stream_name, rows)` posts to the new endpoint and surfaces typed errors (`PositStreamNotRegistered`, `PositValidationError`).
- [ ] `client.upsert_connector_stream(name, connector_name, key_cols, params=None)` creates the stream and configures it with the connector's recommended defaults + user-supplied params in one call.
- [ ] All three are covered by `sdk/tests/test_connectors.py`.

**Client UI**
- [ ] Anatomy DAG renders a `ConnectorNode` upstream of every connector-fed stream, labelled with the connector's display name. Input-side edge label is the connector's input-type label; output-side is the stream's output-unit label.
- [ ] Stream Canvas Identity section gains a `Connector` selector (default: none = user-fed).
- [ ] When a connector is picked, sections 2–6 auto-fill from the connector's recommendations and **lock** (read-only, no override toggle in v1). Section 2's "sample CSV" input is replaced with the connector's input-schema description.
- [ ] Section 7 (Preview/Footer) in connector mode shows an SDK integration snippet — e.g. `await client.push_connector_input("rv_btc", [{"timestamp": "...", "symbol": "BTC", "price": 68500.0}])`.
- [ ] Activating a connector-fed stream creates + configures in one call and closes the canvas. The stream appears in the DAG with its `ConnectorNode` upstream.
- [ ] Existing `STREAM_TEMPLATES` UI is gone. No "Use template" button, no `?template=…` URL handling, no template-prefill side-effects in `StreamCanvas.tsx` or `canvasState.ts`.

**Docs / decisions**
- [ ] `docs/decisions.md` gains a dated entry covering: (a) server-side connector architecture, (b) IP-boundary rationale, (c) explicit decision not to overhaul the 4-space epistemology in `docs/product.md`.
- [ ] `docs/sdk-quickstart.md` gains a short "Connector-fed streams" section with a minimal realized-vol example.
- [ ] `docs/architecture.md` Key Files table gains rows for every new file.
- [ ] `docs/stack-status.md` has a `Connector (realized_vol)` row at PROD status.

### Performance

- Connector input ingest is **hot-path** — one call per spot tick. Per-row processing must be O(1) in history length (EWMA is recursive, no ring buffer needed). Throughput target: 100 ticks/sec/stream sustained without p99 latency regression in the WS ticker loop.
- Memory per active connector-fed stream: O(symbols × snapshot_lengths). For the default `[1s, 60s, 3600s]` config and a typical 2-symbol book, ~6 state records × ~40 bytes = trivial.
- The connector emits a fresh snapshot row only when `avg_rv` changes — so at most one pipeline-dirty flag flip per ingested tick. Existing dirty-flag coalescing in the WS ticker absorbs the rest.

### Security

- `POST /api/streams/{name}/connector-input` is auth-gated identically to the existing snapshot endpoint (API key + user scope).
- The catalog endpoint (`GET /api/connectors`) is public within an authenticated session — it returns metadata only, never implementation.
- Connector source files live in `server/core/connectors/`, mirroring the IP posture of the pricing pipeline. Those files are **never** served to the client, never inlined in logs beyond the connector's `name` / `display_name`.
- Connector state keyed by `(user_id, stream_name, symbol)` — cleanly per-user, no cross-user leakage. Evicted on stream delete or user deletion.

---

## Technical Approach

### Data flow

```
[SDK integrator pushes spot ticks]
        ↓  POST /api/streams/{name}/connector-input  (or ClientWsConnectorInputFrame)
[server/api/routers/snapshots.py → connector_ingest_handler]
        ↓
[server/api/connector_state.py → ConnectorStateStore.process(user, stream, rows)]
        ↓ (runs the connector's .process() from server/core/connectors/)
[StreamRegistration.snapshot_rows ← emitted SnapshotRow (if state changed)]
        ↓
[engine_state.rerun_pipeline() — dirty-flag coalesced as today]
        ↓
[WS ticker broadcasts next tick; pipeline sees fresh raw_value]
```

The connector is invoked synchronously inside the HTTP/WS handler before the dirty-flag set — same pattern as today's snapshot ingest. No background workers, no extra threading.

### Algorithm — `realized_vol` connector

**Intent.** Produce an annualized realized-volatility estimate for a symbol by aggregating EWMA-variance estimators taken over multiple return horizons (default: 1s, 60s, 3600s returns). The EWMA accounts for sample age (time-decayed weight) and sample size (effective sample count tracked per horizon).

**State** (per `(user_id, stream_name, symbol)`, keyed inside the connector):

```python
@dataclass
class _SnapshotLengthState:
    last_ts: datetime | None         # Timestamp of the last sampled tick
    last_price: float | None         # Price at the last sampled tick
    ewma_ann_var: float              # EWMA of annualized variance
    n_eff: float                     # Effective sample count (time-decayed)

@dataclass
class _SymbolState:
    per_length: dict[int, _SnapshotLengthState]  # keyed by snapshot_length_seconds
    last_emitted_rv: float | None    # Last emitted raw_value — only emit on change

@dataclass
class RealizedVolState:
    per_symbol: dict[str, _SymbolState]
```

**Params** (user-configurable, all validated at stream-configure time):

- `halflife_minutes: int` — default `1440` (1 day). Must be > 0.
- `snapshot_lengths_seconds: list[int]` — default `[1, 60, 3600]`. Must be non-empty, all entries > 0, deduplicated, ascending.

**Process** (called with `rows: list[ConnectorInputRow]`, each row `{timestamp, symbol, price}`):

For each row (in ascending timestamp order — sort inbound batch):
1. Reject rows where `price <= 0` (ValueError → 422).
2. Reject rows whose timestamp is ≤ the most recent seen timestamp for that symbol (out-of-order → 422).
3. Ensure `_SymbolState` exists for `symbol`; lazily init `_SnapshotLengthState` entries for each configured snapshot length.
4. For each snapshot length `Δt_i` and its state `s`:
   - If `s.last_ts is None`: set `s.last_ts = row.timestamp`, `s.last_price = row.price`. Continue.
   - Let `elapsed = (row.timestamp - s.last_ts).total_seconds()`.
   - If `elapsed < Δt_i`: continue (interval not yet spanned).
   - Compute log return `r = ln(row.price / s.last_price)`.
   - Compute annualized variance sample: `x = r**2 * (SECONDS_PER_YEAR / elapsed)`.
   - Apply time-decayed EWMA update:
     ```
     τ         = halflife_minutes * 60 / ln(2)          # time constant (seconds)
     decay     = exp(-elapsed / τ)
     n_eff_new = 1 + decay * s.n_eff
     ewma_new  = (x + decay * s.n_eff * s.ewma_ann_var) / n_eff_new
     s.ewma_ann_var = ewma_new
     s.n_eff        = n_eff_new
     ```
   - Set `s.last_ts = row.timestamp`, `s.last_price = row.price`.
5. After processing the row, compute the current `avg_rv`:
   - Across all snapshot lengths where `n_eff >= N_EFF_WARMUP_THRESHOLD` (module constant, default `1.0` — i.e., at least one full interval has been observed), take `sqrt(ewma_ann_var)` and average.
   - If no snapshot length is warm yet, `avg_rv = None` (no emission).
6. If `avg_rv` differs from `symbol_state.last_emitted_rv` by more than `RV_EMIT_EPSILON` (module constant, default `1e-9`):
   - Emit a `SnapshotRow(timestamp=row.timestamp, symbol=symbol, raw_value=avg_rv)`.
   - Update `symbol_state.last_emitted_rv = avg_rv`.

Return all emitted rows (zero or more per batch).

**Warmup badge** (Inspector side): for each connector-fed stream, the server reports `min(n_eff)` across snapshot lengths and `N_EFF_WARMUP_THRESHOLD`; the UI renders progress as `min(1, min_n_eff / warmup_target)`. This is surfaced via `StreamStateResponse.connector_state_summary` (new optional field).

### Recommended stream defaults (realized_vol)

These come back in `ConnectorSchema.recommended_*` and are the values the Stream Canvas locks in when the user picks `realized_vol`:

| Field | Value | Rationale |
|---|---|---|
| `scale` | `1.0` | Identity — `raw_value` is already annualized vol points. |
| `offset` | `0.0` | No shift. |
| `exponent` | `2.0` | Lifts vol → variance in calc space (the global raw→calc convention). |
| `block.annualized` | `True` | RV is an annualized quantity. |
| `block.temporal_position` | `"shifting"` | Rolls with current time. |
| `block.decay_end_size_mult` | `1.0` | No decay — RV is a persistent measurement, not an event. |
| `block.decay_rate_prop_per_min` | `0.0` | Same. |
| `block.var_fair_ratio` | `1.0` | Default confidence; user can't override in v1. |

### Keying

- Stream `key_cols = ["symbol"]` (per the user decision in planning — option (a) in Q2).
- Input rows carry `symbol` as the only key beyond `timestamp + price`.
- The scalar `raw_value` fans across every `(symbol, expiry)` pair in the dim universe by the existing `applies_to=None` fan-out in `build_blocks_df` — no change to the pipeline.

### Data shape changes

`server/api/models.py` — **new models:**

```python
class ConnectorParamSchema(BaseModel):
    name: str
    type: Literal["int", "float", "list_int", "list_float"]
    default: Any
    description: str
    min: float | None = None          # None if unbounded
    max: float | None = None

class ConnectorInputFieldSchema(BaseModel):
    name: str                         # e.g. "price"
    type: Literal["float", "int", "str"]
    description: str

class ConnectorSchema(BaseModel):
    name: str                         # machine id, e.g. "realized_vol"
    display_name: str                 # e.g. "Realized Volatility"
    description: str
    input_key_cols: list[str]         # e.g. ["symbol"]
    input_value_fields: list[ConnectorInputFieldSchema]  # e.g. [{name:"price",type:"float",...}]
    output_unit_label: str            # e.g. "annualized vol (fractional)"
    params: list[ConnectorParamSchema]
    recommended_scale: float
    recommended_offset: float
    recommended_exponent: float
    recommended_block: BlockConfigPayload

class ConnectorCatalogResponse(BaseModel):
    connectors: list[ConnectorSchema]

class ConnectorInputRow(BaseModel):
    model_config = {"extra": "allow"}
    timestamp: str
    # Remaining fields validated against the connector's input schema at ingest time.

class ConnectorInputRequest(BaseModel):
    stream_name: str = Field(..., min_length=1)
    rows: list[ConnectorInputRow] = Field(..., min_length=1)

class ConnectorInputResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    rows_emitted: int                 # 0 or more SnapshotRows written to stream
    pipeline_rerun: bool
    server_seq: int = 0
```

**Extended models:**

```python
class AdminConfigureStreamRequest(BaseModel):
    # ... existing fields ...
    connector_name: str | None = None                    # NEW
    connector_params: dict[str, Any] | None = None       # NEW — passed to connector

class StreamResponse(BaseModel):
    # ... existing fields ...
    connector_name: str | None = None                    # NEW
    connector_params: dict[str, Any] | None = None       # NEW

class StreamStateResponse(BaseModel):
    # ... existing fields ...
    connector_name: str | None = None                    # NEW
    connector_params: dict[str, Any] | None = None       # NEW
    connector_state_summary: ConnectorStateSummary | None = None   # NEW

class ConnectorStateSummary(BaseModel):
    min_n_eff: float                  # warmup progress metric
    warmup_threshold: float
    symbols_tracked: int
```

**New client WS frame:**

```python
class ClientWsConnectorInputFrame(BaseModel):
    type: Literal["connector_input"] = "connector_input"
    seq: int
    stream_name: str
    rows: list[ConnectorInputRow]
```

`client/ui/src/types.ts` — **mirrors** (Pydantic is upstream; update TS to match):

```typescript
export interface ConnectorParamSchema { ... }
export interface ConnectorInputFieldSchema { ... }
export interface ConnectorSchema { ... }
export interface ConnectorCatalogResponse { connectors: ConnectorSchema[] }
export interface RegisteredStream {
  // ... existing ...
  connector_name: string | null
  connector_params: Record<string, unknown> | null
}
```

### Files to create

**Server — connector package (`server/core/connectors/`):**

- `server/core/connectors/__init__.py` — re-exports `Connector`, `CONNECTOR_REGISTRY`, `get_connector`.
- `server/core/connectors/base.py` — `Connector` Protocol + `ConnectorState` TypeVar; defines the `initial_state(params) -> State` and `process(state, rows, params) -> tuple[State, list[SnapshotRow]]` interface. Also defines `SECONDS_PER_YEAR` import from `server.core.config`.
- `server/core/connectors/registry.py` — `CONNECTOR_REGISTRY: dict[str, Connector]` populated at import time; `get_connector(name) -> Connector | None`; schema-emission helper `to_schema(connector) -> ConnectorSchema`.
- `server/core/connectors/realized_vol.py` — the realized-vol connector, algorithm per **Algorithm** section above. Includes module constants `N_EFF_WARMUP_THRESHOLD = 1.0`, `RV_EMIT_EPSILON = 1e-9`.

**Server — state + routing:**

- `server/api/connector_state.py` — `ConnectorStateStore` (per-user scoped via `UserRegistry`); methods `process(stream_name, rows) -> list[SnapshotRow]`, `summary(stream_name) -> ConnectorStateSummary`, `evict(stream_name)`. Holds the opaque `state` object returned by the connector and mediates between API-layer rows and connector-layer state.
- `server/api/routers/connectors.py` — `GET /api/connectors` catalog endpoint.

**Server — tests** (use existing test scaffolding — pytest, no new frameworks):

- `server/tests/test_realized_vol_connector.py` — unit tests for the connector math (see **Test Cases**).
- `server/tests/test_connector_endpoints.py` — integration tests for the new routes + ingest path gating.

**SDK:**

- `sdk/tests/test_connectors.py` — respx-backed tests for `list_connectors`, `push_connector_input`, `upsert_connector_stream`.

**Client UI:**

- `client/ui/src/services/connectorApi.ts` — `fetchConnectorCatalog(): Promise<ConnectorCatalogResponse>`.
- `client/ui/src/components/studio/anatomy/nodes/ConnectorNode.tsx` — 200×90 node, visually distinct (subtle accent background, "⚙ CONNECTOR" label badge). Follows the `StreamNode` layout conventions.

**Docs:**

- No new files — see **Files to modify**.

### Files to modify

**Server:**

- `server/api/models.py` — all new/extended models from the **Data shape changes** section.
- `server/api/stream_registry.py` — extend `StreamRegistration` with `connector_name: str | None`, `connector_params: dict[str, Any] | None`. Extend `configure()` to accept + store them. Gate `ingest_snapshot()` to raise `StreamIsConnectorFed` when `connector_name is not None`. New method `ingest_connector_input(stream_name, rows, connector_store) -> tuple[int, int]` (rows_accepted, rows_emitted) that delegates to `ConnectorStateStore.process()`. On `delete(stream_name)`, call `connector_store.evict(stream_name)`.
- `server/api/routers/streams.py` — `POST /api/streams/{name}/configure` accepts + validates `connector_name` against `CONNECTOR_REGISTRY`; validates `connector_params` against the connector's `params` schema. `GET /api/streams/{name}` includes `connector_state_summary` when the stream is connector-fed.
- `server/api/routers/snapshots.py` — new endpoint `POST /api/streams/{name}/connector-input`. `POST /api/snapshots` raises `StreamIsConnectorFed` (409) when target is connector-fed.
- `server/api/client_ws.py` — parse `ClientWsConnectorInputFrame`, route to `ingest_connector_input`. Extend the discriminated inbound union.
- `server/api/main.py` — register `connectors_router`.

**SDK:**

- `sdk/posit_sdk/models.py` — mirror the new Pydantic models (`ConnectorSchema`, `ConnectorCatalogResponse`, `ConnectorInputRow`, `ConnectorInputRequest`, `ConnectorInputResponse`, `ConnectorStateSummary`). Extend `StreamResponse`, `StreamState` with `connector_name`, `connector_params`, `connector_state_summary`.
- `sdk/posit_sdk/rest.py` — `list_connectors()`, `push_connector_input(stream_name, rows, allow_zero_edge=False)`, `configure_stream(...)` gains optional `connector_name` / `connector_params` params.
- `sdk/posit_sdk/ws.py` — `push_connector_input_ws(stream_name, rows)` mirroring `push_snapshot_ws`.
- `sdk/posit_sdk/client.py` — public methods `list_connectors()`, `push_connector_input()`, `upsert_connector_stream(name, connector_name, key_cols, params=None)`. Prefer WS when `connect_ws=True`, REST fallback.
- `sdk/posit_sdk/__init__.py` — re-export new public types.

**Client UI:**

- `client/ui/src/types.ts` — all new interfaces + `RegisteredStream` extensions.
- `client/ui/src/hooks/useConnectorCatalog.ts` **(new)** — fetches `/api/connectors` once per session, cached in memory.
- `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` — register `connector` in `NODE_TYPES`.
- `client/ui/src/components/studio/anatomy/buildAnatomyGraph.ts` — for each stream where `connector_name != null`, emit a `ConnectorNode` at `x = STREAM_COLUMN_X - CONNECTOR_OFFSET` (new constant). Edge: `ConnectorNode → StreamNode` labelled with connector output-unit label.
- `client/ui/src/components/studio/anatomy/anatomyGraph.ts` — add `CONNECTOR_OFFSET` constant (~220px west of stream column).
- `client/ui/src/components/studio/StreamCanvas.tsx` — add connector picker at top of Identity section (`<select>` sourced from `useConnectorCatalog`). When set, lock sections 3–6, auto-fill from connector's `recommended_*` values, and render the integration snippet in Section 7.
- `client/ui/src/components/studio/canvasState.ts` — extend draft state with `connector_name: string | null` and `connector_params: Record<string, unknown>`. When connector changes, reset mapping + block sections to the connector's recommended defaults (or clear if `null`). Remove all `templateId` / template-related state.
- `client/ui/src/components/studio/sections/IdentitySection.tsx` — connector dropdown UI.
- `client/ui/src/components/studio/sections/DataShapeSection.tsx` — when `connector_name` set, replace sample-CSV paste box with a read-only panel showing the connector's `input_value_fields` + `input_key_cols`.
- `client/ui/src/components/studio/sections/TargetMappingSection.tsx` + `BlockShapeSection.tsx` + `ConfidenceSection.tsx` — add `readOnly` prop wired by the parent canvas. When `readOnly`, all inputs are `disabled` with a "Auto-filled from connector" helper caption.
- `client/ui/src/components/studio/sections/PreviewSection.tsx` — when connector-fed, render an integration-snippet block (formatted SDK + curl example). Otherwise unchanged.
- `client/ui/src/services/streamApi.ts` — `configureStream(name, body)` body type gains optional `connector_name` + `connector_params`.
- `client/ui/src/components/studio/anatomy/useAnatomySelection.ts` — when opening a connector-fed stream in the detail panel, pre-select connector params state so the picker reflects current config.

**Docs:**

- `docs/decisions.md` — append a dated entry (`YYYY-MM-DD` at implementation time): "Connectors — server-side pre-built data transforms." Cover the IP decision, why realized-vol first, and why templates are being removed.
- `docs/sdk-quickstart.md` — new section "Connector-fed streams" between the snapshot-ingest section and the long-running-feeder section. Minimal end-to-end example pushing spot ticks to an `rv_btc` stream.
- `docs/architecture.md` — Key Files table gains rows for `server/core/connectors/*`, `server/api/connector_state.py`, `server/api/routers/connectors.py`, `client/ui/src/services/connectorApi.ts`, `client/ui/src/components/studio/anatomy/nodes/ConnectorNode.tsx`. Component Map gains a one-line note: "Connectors are server-side pre-built input transforms — accessory to streams, not a new core concept."
- `docs/stack-status.md` — new row `Connector (realized_vol)` at PROD.
- `CLAUDE.md` — no changes required (Connectors fit existing "server/core/" lane rules).

### Files to delete

- `client/ui/src/components/studio/streamTemplates.ts` — whole file.
- Any `?template=` URL handling in `StreamCanvas.tsx` / `canvasState.ts` / routing.
- `STREAM_TEMPLATES` references anywhere (Grep for `STREAM_TEMPLATES` and `streamTemplates` before committing).

### Suggested phasing (one commit per phase)

1. **Server — connector core.** `server/core/connectors/` (base + registry + realized_vol) + `server/tests/test_realized_vol_connector.py`. No integration yet — pure math + tests green.
2. **Server — state + catalog endpoint.** `server/api/connector_state.py`, `server/api/routers/connectors.py`, new models in `server/api/models.py`, wire `/api/connectors` in `main.py`. `GET /api/connectors` returns the realized_vol schema. Still no ingest.
3. **Server — ingest + stream gating.** Extend `stream_registry.py` and `routers/snapshots.py` with the new endpoint + gates. Extend `client_ws.py` with the new WS frame. Integration tests in `server/tests/test_connector_endpoints.py`. After this phase, realized-vol works end-to-end via `curl` / Postman.
4. **SDK.** Mirror the catalog/ingest models; add `list_connectors`, `push_connector_input`, `upsert_connector_stream`. `sdk/tests/test_connectors.py`. After this phase, a Python integrator can use the connector end-to-end.
5. **UI — Anatomy node.** `types.ts`, `connectorApi.ts`, `useConnectorCatalog.ts`, `ConnectorNode.tsx`, `buildAnatomyGraph.ts`. After this phase, an already-configured connector-fed stream visibly renders in Anatomy with its ConnectorNode upstream.
6. **UI — Stream Canvas.** Section edits + Identity picker + canvasState rework. After this phase, user can create a realized-vol stream entirely from the canvas.
7. **Cleanup — Stream Templates removal.** Delete template file + references. Verify no regressions.
8. **Docs.** `docs/decisions.md`, `docs/sdk-quickstart.md`, `docs/architecture.md`, `docs/stack-status.md`.

Each phase ends with:
```
python -m compileall server/ -q
npm --prefix client/ui run typecheck
# plus targeted pytest runs for phases 1/3/4
```

---

## Test Cases

### realized_vol math (unit tests — `server/tests/test_realized_vol_connector.py`)

- **Constant price, many ticks** → `avg_rv ≈ 0` after warmup. Confirms zero-return case.
- **Perfect geometric Brownian with known σ, single snapshot length, long history** → `avg_rv → σ` (annualized) within a tolerance. Use `np.random.default_rng(seed=...)` for reproducibility.
- **Step change in price** (e.g., 1% jump) → variance spike in the shortest snapshot length, gradual decay over `halflife_minutes`. Verify decay rate matches `exp(-t/τ)` within 5%.
- **Irregular sampling** (ticks at t=0s, t=0.3s, t=0.7s, t=1.1s with a 1-second snapshot length) → only the tick at t≥1s triggers an update; annualization uses the actual 1.1s interval, not the nominal 1s.
- **Multiple snapshot lengths** (`[1, 60, 3600]`) on a GBM feed → `avg_rv` is within tolerance of the ground truth σ; each length independently converges.
- **Warmup behavior** → first tick for a symbol: no emission. Second tick that spans the shortest length: emission with `avg_rv > 0`. Warmup metric `min(n_eff)` correctly reports progress.
- **Out-of-order tick** → raises ValueError (surfaced as 422 at the API layer).
- **Non-positive price** → raises ValueError.

### Endpoint integration (`server/tests/test_connector_endpoints.py`)

- **Happy path:** `POST /api/streams` → `POST /api/streams/{name}/configure` with `connector_name="realized_vol"` → `POST /api/streams/{name}/connector-input` with 100 GBM ticks → assert stream has a `raw_value` populated, pipeline rerun was triggered, `GET /api/streams/{name}` returns `connector_state_summary` with `min_n_eff > 0`.
- **Pushing snapshots to a connector-fed stream** → 409 `STREAM_IS_CONNECTOR_FED`.
- **Pushing connector-input to a user-fed stream** → 409 `STREAM_IS_NOT_CONNECTOR_FED`.
- **Unknown connector name at configure** → 400 `UNKNOWN_CONNECTOR`.
- **Invalid connector params** (e.g., `halflife_minutes: -10`) → 422.
- **Missing input-schema field** (row without `price` or `symbol`) → 422.
- **Stream delete evicts connector state** → after delete, `GET /api/streams/{name}` → 404, and recreating with the same name starts with fresh warmup.

### SDK (`sdk/tests/test_connectors.py`)

- `list_connectors()` parses the catalog response; returns typed models.
- `push_connector_input()` round-trip against a respx-mocked `POST /api/streams/rv_btc/connector-input`. Verifies the emitted HTTP payload matches `ConnectorInputRequest`.
- `upsert_connector_stream("rv_btc", "realized_vol", ["symbol"])` issues `POST /api/streams` + `POST /api/streams/rv_btc/configure` with the right payload (including `connector_name`).
- `push_connector_input()` against an unconfigured stream surfaces `PositStreamNotRegistered`.
- `push_connector_input()` against a user-fed stream surfaces `PositValidationError` (409 → typed error).

### UI (manual smoke tests — no new automated UI tests required)

- Open Studio → Anatomy → click "+ New stream" → pick "Realized Volatility" from the connector dropdown → canvas sections 3–6 lock + show auto-filled values → section 7 shows integration snippet → Activate → ConnectorNode + StreamNode appear in DAG.
- Editing an existing connector-fed stream: canvas re-hydrates with the connector preselected, locks intact.
- Push spot ticks via Postman to the new endpoint → within one WS tick, the stream's raw_value appears in the pipeline chart and the Inspector shows warmup progress.
- Verify `?template=…` URL no longer does anything (no template prefill, no errors).

### Edge cases

- **WS disconnect mid-ingest** → client reconnects; any already-ACKed frames are not replayed; connector state is preserved (in-memory, same process). Unacked frames are retransmitted by the SDK's existing backfill logic.
- **Server restart** → connector state lost. Re-warms from next tick; operator is expected to tolerate this for v1 (logged as a known limitation in `docs/stack-status.md`).
- **Empty state** (user hasn't created any connector-fed streams) → `GET /api/connectors` still returns the catalog; Anatomy renders zero ConnectorNodes. Stream Canvas connector picker offers `realized_vol` as an option regardless.
- **Two users same stream name** → each has their own registry / connector state per existing per-user scoping.
- **Malformed input from external source** → validated at API boundary via Pydantic; 422 with readable error; no corruption of connector state.
- **Auth failure** → identical to other auth-gated endpoints; 401 before any connector code runs.

---

## Out of Scope

- **Additional connectors beyond realized_vol.** Second connector is deferred until the first ships and real usage surfaces which one is most valuable. Patterns in `base.py` / `registry.py` must be general enough that adding one is a single-file change.
- **LLM Build-mode integration.** Build mode (`server/api/llm/prompts/build.py`) does not learn about connectors in this spec. A follow-up spec will cover `create_connector_stream` engine commands. Until then, connectors are pick-from-catalog only.
- **Epistemology overhaul in `docs/product.md`.** Per the user's direction, Connectors are framed as accessory/convenience, not a new fundamental concept. The existing 4-space model (risk / raw / calc / target) stays unchanged; connectors produce `raw_value` the same way user-owned feeds do.
- **Connector state persistence across server restarts.** In-memory only for v1. If this becomes painful, a second spec adds snapshot-to-disk with warmup replay.
- **Connector param overrides after stream creation.** v1 locks params at configure time. Changing params means delete + recreate the stream. Future: `PATCH /api/streams/{name}/connector-params`.
- **Per-section override unlock in Stream Canvas.** v1 auto-fills and locks sections 3–6 with no escape hatch. If a trader needs a different `var_fair_ratio`, they either create a user-fed stream or file the escape-hatch feature request.
- **Connector versioning / param-schema migration.** The first param change after a connector ships will force us to design this. Not now.
- **Backpressure / rate-limiting on `/connector-input`.** Relies on FastAPI's default concurrency limits and the existing dirty-flag pipeline-rerun coalescer. If high-volume integrations reveal a bottleneck, a dedicated spec adds per-user token buckets.
- **Input-rate metrics / observability for connector streams.** No new Prometheus-style counters in v1. The existing `last_ingest_ts` + `row_count` on `StreamStateResponse` carry forward and are enough for a human operator to confirm "data is arriving."

---

## Handoff notes for the implementer

- Re-read `tasks/lessons.md` before starting. Especially: the ULP-drift / `maintain_order` lesson (if you're doing any comparison testing), the canonical-key lesson (Pydantic validators at ingest for symbol/timestamp), and the "React key collision" lesson (ConnectorNode IDs need to be unique across the DAG — prefix `connector-{stream_name}`).
- Surgical commits, conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`), one phase = one commit.
- Server-core files are now a normal LLM lane (Manual Brain Rule lifted 2026-04-21) — you can edit `server/core/connectors/` freely.
- Typecheck after every batch: `python -m compileall server/ -q` + `npm --prefix client/ui run typecheck`. Don't commit without both green.
- Never push without being asked. Never bypass hooks.
- When the spec is wrong, update `tasks/spec-connectors.md` **before** coding around it — the spec is source of truth.
