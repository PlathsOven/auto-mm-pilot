# Spec: Exposure → Position translation (Stage H)

## Overview

The pipeline's Stage G (`position_sizing`) currently outputs per-(symbol, expiry) numbers that are interpreted in the UI as "desired positions." Conceptually they are **net desired exposures** — what the trader wants their exposure to be to each risk dimension **before** accounting for correlations between symbols and between expiries. This spec adds **Stage H (`exposure_to_position`)**: a correlation-aware translation that converts the exposure vector into the actual position vector the trader should put on, using two independent correlation matrices (one across symbols, one across expiries) that the trader maintains in the Anatomy canvas. Matrices default to identity — day-one behaviour for every existing user is numerically unchanged.

## Requirements

### User stories

- **As the quant desk head**, I want to express "if these two symbols are 60% correlated, and I want +100 exposure to each, I don't actually need to hold +100 of each — I need to hold less, because the first position already gives me some exposure to the second." I want Posit to solve for the actual position automatically.
- **As the quant desk head**, I want to see what my positions *would* become under a draft correlation change before I commit it, **live and continuously**, so I can iterate on correlations the same way I iterate on manual blocks.
- **As the quant desk head**, I want the system to fail loudly when my correlation matrix is degenerate (singular, or close to singular) so I don't silently get absurd positions from a near-unconstrained inverse.
- **As the quant desk head**, I want the correlation editor to be part of the Anatomy DAG (not a hidden settings page) so I can see that correlations are first-class pipeline infrastructure, not configuration trivia.

### Acceptance criteria

- [ ] A new Anatomy node labelled **"Correlations"** sits between `position_sizing` and the `Desired Position` output. Edge going in is labelled `exposure(t)`; edge going out is labelled `position(t)`.
- [ ] Clicking the Correlations node opens the NodeDetailPanel sidebar with two editable matrices: **Symbol Correlations** (k×k) and **Expiry Correlations** (m×m). Only the **upper triangle** is editable; the lower triangle mirrors automatically. Diagonal is locked at 1.0 and visually dimmed.
- [ ] With both matrices at identity (the default), the pipeline's position output is cell-for-cell identical to today's output. Verified by a parity test.
- [ ] When a user edits a cell in the editor, the edit is debounced (500 ms) and PUT to the server as a **draft**. The pipeline reruns on the dirty-flag coalescing path (same as market-value edits). The next WS tick broadcasts **both** the committed positions (unchanged) and the draft positions (updated) to the client.
- [ ] The position grid gains a new view mode **"Position"** (the actual post-correlation position — this is today's `smoothedDesiredPos`, semantically renamed in comments/docs only) and **"Exposure"** (the pre-correlation Kelly output, new). Both are live-updating.
- [ ] The CellInspector for any (symbol, expiry) always shows both scalars (exposure + position) side-by-side, unconditionally. No conditional suppression when they happen to be equal — keeping the rendering simple and consistent is worth the minor redundancy on the identity-matrix case.
- [ ] When a draft exists, every position cell shows a small annotation ("draft: X.XX") alongside the committed value. Clicking **Confirm** opens a loud modal displaying the per-cell position **diff** table (committed → hypothetical, with the sum of absolute diffs highlighted). Confirming promotes draft → committed atomically; discarding clears the draft.
- [ ] On server restart or fresh account, the correlation stores start empty (both matrices identity). No correlation seeds.
- [ ] `PositionHistoryPoint` captures the full committed symbol and expiry matrices at each rerun. The Position chart replays historical positions using the matrices that were active at each historical point — **not** retroactively recomputed under today's matrices.
- [ ] If either committed or draft matrix is singular or has `det(C) < 1e-9`, the pipeline rerun **fails loudly** for that matrix: the UI surfaces an error notification ("Symbol correlation matrix is singular — check for perfect correlations") and the Confirm button disables. No silent Tikhonov fallback.
- [ ] A separate preparatory commit renames every occurrence of `PositionDelta` / `deltas` / `absolute_change` that means "diff" to `PositionDiff` / `diffs` / `absolute_diff` — see **Milestone 0** below.

### Performance

- **Cold path.** Correlation editing is a human-driven REST interaction. Matrix inversion on k×k and m×m matrices where k, m < 30 in practice is sub-millisecond (`np.linalg.solve`).
- **Hot path (per-rerun).** Stage H adds two matrix inversions + two matmul ops per pipeline rerun. At k=m=20 that's ~50 µs total on numpy — negligible against the existing ~10 ms Polars pipeline.
- **When a draft exists**, Stage H runs twice per rerun (once with committed matrices, once with draft matrices). Stages A–G are untouched and run once. Extra cost: one more 50 µs matrix op — still negligible.
- **History memory.** Each `PositionHistoryPoint` grows by `8 · (k² + m²)` bytes for the full matrix snapshots. At k=m=20 that's ~6.4 KB per point × 4096-point cap = ~26 MB per user. Acceptable at current scale; revisit if k exceeds 50.

### Security

- **Auth.** All correlation endpoints sit under the existing session-token auth used by `/api/market-values`. No API-key surface, no `/ws/client` frame types, no new admin endpoints.
- **Exposure.** Correlation matrices are strategy IP — they never leave the server except in response to an authenticated GET by the owning user. The singleton broadcast ticker scopes per-user as it does today.
- **Logging.** Upserts log `(user_id, a, b, rho)` at INFO — matches `MarketValueStore` precedent. No matrix-wide dumps on any code path.

## Technical Approach

### Math

The pipeline at Stage G emits a desired exposure `E[i, j]` for every `(symbol_i, expiry_j)` pair, per timestamp. We treat this as a k×m matrix where k is the symbol count and m is the expiry count, each timestamp. Given a symbol correlation matrix `C_s ∈ R^{k×k}` and an expiry correlation matrix `C_e ∈ R^{m×m}`, both symmetric with unit diagonal, we solve:

```
C_s · P · C_e = E
```

for the position matrix `P` using separable direct inversion:

```
P = C_s⁻¹ · E · C_e⁻¹
```

This is the canonical back-out-positions-from-exposure calculation (hedging desks use it). It has a unique solution when both matrices are non-singular. There is **no regularisation and no optimisation objective** — if the matrix is singular we fail loudly and ask the trader to fix the matrix. The decision is captured in `docs/decisions.md`.

### Staging + draft model

A per-user `SymbolCorrelationStore` (and `ExpiryCorrelationStore`) holds **two slots**: `committed` (the matrix the engine applies) and `draft` (optional — the matrix the editor is currently shaping). When a draft exists, the pipeline runs Stage H twice:

1. With `committed` → produces `raw_desired_position` / `smoothed_desired_position` (the trader's actual position, unchanged wire semantics).
2. With `draft` → produces `raw_desired_position_hypothetical` / `smoothed_desired_position_hypothetical` (new columns, null when no draft).

The Kelly output (pre-correlation) is always emitted as `raw_desired_exposure` / `smoothed_desired_exposure` — new columns, unaffected by either matrix.

### Wire representation

Matrices are stored and transmitted as **upper-triangle entry lists**: `[{a, b, rho} for a < b]`. The store canonicalises `(a, b)` to the sorted-tuple form on every write. Diagonal entries are never stored — they are always 1.0 by definition. Clients materialise the full symmetric matrix locally for display; the pipeline materialises it (with `numpy`) once per rerun.

### Data shape changes

#### `server/api/models.py` (additions)

```python
class CorrelationEntry(BaseModel):
    """One upper-triangle correlation entry. a < b enforced by validator."""
    a: str = Field(..., min_length=1)
    b: str = Field(..., min_length=1)
    rho: float = Field(..., ge=-1.0, le=1.0)

    @model_validator(mode="after")
    def _enforce_upper_triangle(self):
        if self.a == self.b:
            raise ValueError("Diagonal entries are implicit (always 1.0) — "
                             "do not include self-pairs.")
        if self.a > self.b:
            self.a, self.b = self.b, self.a
        return self


class SymbolCorrelationEntry(CorrelationEntry):
    """Entry in the symbol correlation matrix. a and b are symbol names."""
    pass


class ExpiryCorrelationEntry(CorrelationEntry):
    """Entry in the expiry correlation matrix. a and b are canonical-ISO expiry strings.

    The `canonical_expiry_key` validator runs in the router before construction
    so DDMMMYY inputs are normalised to naive ISO before the upper-triangle
    check.
    """
    pass


class SymbolCorrelationListResponse(BaseModel):
    """GET /api/correlations/symbols — returns both committed and draft slots."""
    committed: list[SymbolCorrelationEntry]
    draft: list[SymbolCorrelationEntry] | None = None  # None = no draft live


class ExpiryCorrelationListResponse(BaseModel):
    committed: list[ExpiryCorrelationEntry]
    draft: list[ExpiryCorrelationEntry] | None = None


class SetSymbolCorrelationsRequest(BaseModel):
    """PUT /api/correlations/symbols/draft — overwrites the draft matrix."""
    entries: list[SymbolCorrelationEntry]


class SetExpiryCorrelationsRequest(BaseModel):
    entries: list[ExpiryCorrelationEntry]


# Extend existing DesiredPosition wire shape (ADDITIVE — no renames):
class DesiredPosition(_WireModel):
    # ... all existing fields unchanged ...
    # NEW (always emitted — equal to desired_pos fields when matrices are identity):
    raw_desired_exposure: float
    smoothed_desired_exposure: float
    # NEW (nullable — None when no draft live):
    raw_desired_position_hypothetical: float | None = None
    smoothed_desired_position_hypothetical: float | None = None
```

#### `client/ui/src/types.ts` (additions)

```typescript
export interface SymbolCorrelationEntry { a: string; b: string; rho: number; }
export interface ExpiryCorrelationEntry { a: string; b: string; rho: number; }

export interface SymbolCorrelationListResponse {
  committed: SymbolCorrelationEntry[];
  draft: SymbolCorrelationEntry[] | null;
}
export interface ExpiryCorrelationListResponse {
  committed: ExpiryCorrelationEntry[];
  draft: ExpiryCorrelationEntry[] | null;
}

export interface SetSymbolCorrelationsRequest { entries: SymbolCorrelationEntry[]; }
export interface SetExpiryCorrelationsRequest { entries: ExpiryCorrelationEntry[]; }

// Extend DesiredPosition (ADDITIVE):
export interface DesiredPosition {
  // ... existing ...
  rawDesiredExposure: number;
  smoothedDesiredExposure: number;
  rawDesiredPositionHypothetical: number | null;
  smoothedDesiredPositionHypothetical: number | null;
}

// Extend ViewMode enum:
export type ViewMode =
  | "position" | "rawPosition"
  | "exposure" | "rawExposure"         // NEW
  | "edge" | "smoothedEdge"
  | "variance" | "smoothedVar"
  | "fair" | "smoothedFair"
  | "marketSource" | "marketCalculated" | "smoothedMarketCalculated";
```

#### New routes (all behind session-token auth)

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET`  | `/api/correlations/symbols` | — | Read committed + draft. |
| `PUT`  | `/api/correlations/symbols/draft` | `SetSymbolCorrelationsRequest` | Overwrite the draft slot with the given upper-triangle entries. Triggers dirty flag. |
| `POST` | `/api/correlations/symbols/confirm` | — | Promote draft → committed atomically. Clears draft. Triggers dirty flag + rerun + broadcast. |
| `POST` | `/api/correlations/symbols/discard` | — | Clear draft. Triggers dirty flag + rerun so the hypothetical columns empty out. |
| `GET`  | `/api/correlations/expiries` | — | (same shape as symbols). |
| `PUT`  | `/api/correlations/expiries/draft` | `SetExpiryCorrelationsRequest` | |
| `POST` | `/api/correlations/expiries/confirm` | — | |
| `POST` | `/api/correlations/expiries/discard` | — | |

**Atomicity of Confirm:** one matrix at a time. Symbol Confirm does not imply Expiry Confirm. This matches the "two independent matrices, two independent confirm flows" decision.

### Pipeline integration

In `server/core/pipeline.py`, Stage G's current output — the two columns `raw_desired_position` and `smoothed_desired_position` — is renamed in intent (not on the wire yet) to "exposure." Stage H then:

1. Copies `raw_desired_position` → `raw_desired_exposure` and `smoothed_desired_position` → `smoothed_desired_exposure` (new columns; preserves backward compatibility).
2. For each unique timestamp, pivots the (symbol × expiry) exposure grid into a dense numpy `k×m` matrix `E`.
3. Solves `P = np.linalg.solve(C_s, E) @ np.linalg.inv(C_e)` (or equivalently two solves). **Singularity check first** — if `abs(np.linalg.det(M)) < 1e-9` for either matrix, raise `SingularCorrelationError` with the matrix name.
4. Un-pivots `P` back onto the long Polars frame, overwriting `raw_desired_position` / `smoothed_desired_position`.
5. If a `draft` matrix exists (either symbol or expiry), repeat steps 2–4 using the draft matrices, writing to new nullable columns `raw_desired_position_hypothetical` / `smoothed_desired_position_hypothetical`. When no draft is live, these columns are filled with `null`.

The Stage H function signature:

```python
@transform("exposure_to_position", "correlation_inverse",
           description="Back out actual position from exposure: P = C_s^-1 · E · C_e^-1",
           formula="P = C_s⁻¹ · E · C_e⁻¹")
def etp_correlation_inverse(
    df: pl.DataFrame,
    risk_dimension_cols: list[str],
    symbol_correlations: dict[tuple[str, str], float],  # upper-triangle entries
    expiry_correlations: dict[tuple[str, str], float],
    symbol_correlations_draft: dict[tuple[str, str], float] | None,
    expiry_correlations_draft: dict[tuple[str, str], float] | None,
    exposure_col: str,
    position_col: str,
    hypothetical_col: str | None,
) -> pl.DataFrame:
    ...
```

Call twice from `pipeline.py` — once for raw, once for smoothed — so the column plumbing stays explicit.

**Singularity surfacing.** `SingularCorrelationError` is caught in `engine_state.rerun_pipeline` and raised as a typed notification through the same channel `MarketValueMismatchAlert` uses. A new `CorrelationSingularAlert(matrix_kind, det, condition_number)` wire shape is added. The UI's Notifications Center renders it with a CTA "Open correlation editor" deep-linking into the Anatomy Correlations node.

### Historical replay

`PositionHistoryPoint` gains two new fields:

```python
@dataclass(frozen=True)
class PositionHistoryPoint:
    # ... existing ...
    raw_desired_exposure: float
    smoothed_desired_exposure: float
    # Full committed matrices at this rerun — used by the Position chart to
    # annotate historical points. Stored inline; see Performance → History memory.
    symbol_correlations: dict[tuple[str, str], float]
    expiry_correlations: dict[tuple[str, str], float]
```

The Pipeline chart's Position view gains an optional overlay line "exposure" when the user toggles a new "Show exposure" checkbox. Historical matrices are displayed in the CellInspector as a small badge "correlations as of this rerun differ from current" when appropriate.

### Anatomy DAG integration

In `client/ui/src/components/studio/anatomy/anatomyGraph.ts`:
- Append `"correlations"` to `PIPELINE_ORDER`.
- Insert between `position_sizing` and the `Desired Position` output node. Shift the output node's X coordinate right by one pitch (640 px).
- Extend `NODE_TRACKS.correlations = { in: [] , out: [] }` — single default handle in/out since it collapses to a single "position" track.
- Delete the edge `e-ps-output` and replace with `e-ps-corr` (`position_sizing → correlations`, label `exposure(t)`) and `e-corr-output` (`correlations → output`, label `position(t)`).

A new `CorrelationsNode.tsx` renders:
- Node label "Correlations."
- Two compact heat-map previews (one per matrix), each ~80 × 60 px, colour-encoding ρ values from the currently-committed entries. Draft entries shown with a dashed outline.
- Hover popover: symbol count / expiry count, "draft pending" badge if a draft exists, "singular — fix" warning badge if either matrix failed the det-check on the last rerun.

Clicking the node reuses `NodeDetailPanel` — the detail kind is a new `{ kind: "correlations" }` case that routes to the new `<CorrelationsEditor/>` component.

### CorrelationsEditor UX

Two matrix grids stacked (Symbols first, then Expiries). Each grid:
- Rows and columns labelled with symbol/expiry names in the same canonical order the pipeline uses (lex sort).
- Diagonal cells fixed at 1.0, non-editable, dimmed.
- Upper-triangle cells editable (number input, range `[-1, 1]`, two-decimal precision). Lower triangle auto-mirrors the upper triangle value, read-only styling.
- A **Confirm** button per matrix with state: disabled when no draft exists OR when the draft matrix is singular. Enabled when draft differs from committed AND non-singular.
- A **Discard** button per matrix — revert the draft to committed.
- A live inline "diff summary": "Applying this draft moves N positions (Σ|diff| = X.XX)." Computed client-side from the WS-broadcast `*_hypothetical` columns.
- A bottom-of-matrix status pill: "Committed" (green) / "Draft pending" (amber) / "Singular — cannot confirm" (red).

**Confirm flow:** click Confirm → modal opens showing the full per-(symbol, expiry) diff table (columns: cell, committed, hypothetical, diff). Copy above the table is LOUD: "⚠️ This will change live positions. Review the diffs before confirming." Two buttons: "Cancel" and "Yes, commit."

### Files to create

- `server/core/transforms/exposure_to_position.py` — the new transform module.
- `server/api/correlation_store.py` — per-user symbol + expiry stores with committed/draft slots.
- `server/api/routers/correlations.py` — the eight routes above.
- `server/api/correlation_matrix.py` — pure-function helpers: `materialise_matrix(entries, labels) -> np.ndarray`, singularity checks.
- `client/ui/src/services/correlationsApi.ts` — `apiFetch` wrappers for every route.
- `client/ui/src/components/studio/anatomy/nodes/CorrelationsNode.tsx` — node card.
- `client/ui/src/components/studio/correlations/CorrelationsEditor.tsx` — the two-matrix editor.
- `client/ui/src/components/studio/correlations/MatrixGrid.tsx` — one matrix's grid; reused for symbols + expiries.
- `client/ui/src/components/studio/correlations/ConfirmMatrixModal.tsx` — loud confirm modal with position-diff table.
- `client/ui/src/hooks/useCorrelationsDraft.ts` — owns client-side draft state + debounce + PUT plumbing.

### Files to modify

**Server**
- `server/core/transforms/__init__.py` — import the new transform module.
- `server/core/transforms/registry.py` — `_define_step("exposure_to_position", ...)`.
- `server/core/pipeline.py` — add Stage H after Stage G; plumb the new columns.
- `server/api/models.py` — add correlation models; extend `DesiredPosition`; add `CorrelationSingularAlert`; extend `ServerPayload.correlation_alerts`.
- `server/api/main.py` — register the correlations router.
- `server/api/engine_state.py` — read both correlation stores on `rerun_pipeline`, forward to `run_pipeline`.
- `server/api/ws.py` — extend `_check_dirty_rerun` to also inspect the two correlation stores' dirty flags.
- `server/api/ws_serializers.py` — `positions_at_tick` selects the four new columns (two exposure, two hypothetical) and emits on the wire.
- `server/api/position_history.py` — extend `PositionHistoryPoint`; accept matrices in `push_rows`.
- `server/core/serializers.py` — `snapshot_from_pipeline` / `engine_state_from_pipeline` carry the new fields.
- `server/api/llm/snapshot_buffer.py` — expose exposure on `ideal_desired_position` (keep `raw_desired_position` alias for back-compat).

**Client**
- `client/ui/src/types.ts` — all type additions above.
- `client/ui/src/constants.ts` — `VIEW_MODE_META` gets `"exposure"` + `"rawExposure"` entries.
- `client/ui/src/utils.ts` + `viewMode`-resolving helpers — new cases.
- `client/ui/src/components/DesiredPositionGrid.tsx` — new view modes in the metric dropdown; show `* draft` suffix in any cell where `rawDesiredPositionHypothetical` is non-null.
- `client/ui/src/components/workbench/inspectors/CellInspector.tsx` — render exposure + position side-by-side; show hypothetical when draft is live.
- `client/ui/src/components/PipelineChart/chartOptions.ts` — Position view can overlay exposure line.
- `client/ui/src/components/studio/anatomy/anatomyGraph.ts` — graph additions above.
- `client/ui/src/components/studio/anatomy/buildAnatomyGraph.ts` — render the new node + re-route edges.
- `client/ui/src/components/studio/anatomy/useAnatomySelection.ts` — new `correlations` selection kind.
- `client/ui/src/components/studio/anatomy/NodeDetailPanel.tsx` — route correlations selection to the editor.
- `client/ui/src/hooks/usePositionEdit.ts` — block inline-edits on the Exposure view modes (exposures are pipeline-computed, not trader-entered).
- `docs/architecture.md` — Key Files table gets new rows; Data Flow diagram gains "Step 9: Correlation translation."
- `docs/decisions.md` — new entry dated on the implementation day explaining the choice of direct inversion.
- `docs/stack-status.md` — new "Correlation Store" row (PROD).
- `docs/product.md` — new subsection under "How the Engine Thinks" explaining exposure vs position.

### Milestone 0 — preparatory `PositionDelta` → `PositionDiff` rename

**This is a pure-rename commit that happens before any Stage H work.** Every occurrence of the word "delta" that means "subtraction / diff" is renamed to "diff." Occurrences that refer to the options Greek are untouched.

Files modified:
- `server/api/models.py` — `PositionDelta` → `PositionDiff`; `PreviewResponse.deltas` → `diffs`; `PositionDiff.absolute_change` → `absolute_diff`.
- `server/api/llm/preview.py` — `_compute_deltas` → `_compute_diffs`; all internal references.
- `server/api/llm/service.py` — any log lines.
- `server/api/llm/client.py` — same.
- `server/api/llm/snapshot_buffer.py` — same.
- `client/ui/src/types.ts` — `PositionDelta` → `PositionDiff`; field renames.
- `client/ui/src/components/proposal/ProposalPreviewDrawer.tsx` — all field references.
- `tasks/spec-llm-orchestration.md` — update references (this is a spec, not live code, but keep it consistent).
- `client/ui/UI_SPEC.md` — same.
- `.claude/commands/ui-design.md` + `.windsurf/workflows/ui-design.md` — same (paired harness sync rule).

Verification: `python -m compileall server/ -q` + `npm --prefix client/ui run typecheck` after the rename. One commit titled `refactor: rename PositionDelta/deltas → PositionDiff/diffs`. Proceed to Milestone 1 only after this lands.

## Test Cases

### Happy paths
- **Identity matrices (default state).** After running the pipeline with both matrices at identity, assert `raw_desired_position == raw_desired_exposure` and `smoothed_desired_position == smoothed_desired_exposure` cell-for-cell. Cover `k, m = 1, 2, 5, 10`.
- **Two-symbol hand-checked case.** Symbols = [BTC, ETH]; one expiry; `ρ = 0.5`. Input exposure `[100, 100]`. Expected position `P = C_s⁻¹ · E = [2/3 · 100, 2/3 · 100] = [66.67, 66.67]` (up to tolerance). Assert.
- **Draft flow.** PUT a draft with `ρ(BTC, ETH) = 0.8`; assert next WS broadcast carries non-null `*_hypothetical` columns; POST confirm; assert committed reflects draft and draft slot becomes null; next WS broadcast has `*_hypothetical` = null again.
- **Historical replay.** Change symbol correlations three times with intervening snapshot pushes; assert `PositionHistoryPoint` records the full matrices active at each push and the Position chart renders them.

### Edge cases
- **Empty state.** Fresh account with zero streams. The Correlations node renders with both matrices 0×0; editor shows a placeholder "Register at least one stream to edit correlations." Pipeline skips Stage H (no rows to transform).
- **Single-symbol / single-expiry.** 1×1 matrix is trivially identity; Stage H is a no-op.
- **Singular matrix.** Set `ρ(BTC, ETH) = 1.0` (exactly) with k ≥ 2 symbols — `det(C_s) = 0`. Pipeline rerun fails with `SingularCorrelationError`; the UI surfaces a `CorrelationSingularAlert` notification; the Confirm button disables; existing committed positions remain live.
- **Draft singular; committed fine.** Editor accepts the edit but refuses to Confirm until the draft is non-singular. Committed pipeline continues running normally.
- **Removed stream.** User deletes the only BTC stream. Pipeline universe no longer includes BTC. BTC correlation entries remain in the store (hidden in the editor because BTC isn't in the column set), pipeline materialises matrices from whatever symbols are present. When BTC returns, the entries automatically re-appear.
- **Malformed PUT.** Request with `a == b`, `rho > 1`, `rho < -1`, or `a, b` not strings → 422 from Pydantic. Dirty flag not set.
- **Malformed PUT — non-existent symbol.** Request with `a = "GOOG"` in a pipeline that only has BTC/ETH → accepted and stored (future-symbol entries are fine). Matrix-materialisation step silently ignores entries for labels not in the current pipeline universe.
- **WS disconnect mid-edit.** REST path is unaffected; draft PUT succeeds. On WS reconnect, the replay store sends the latest tick with `*_hypothetical` populated if a draft is live.
- **Two browser tabs editing.** Last-write-wins (same contract as `MarketValueStore`). Documented as today — a follow-up may add optimistic locking.
- **Concurrent Confirm + PUT draft.** Server-side atomic: Confirm grabs the lock, swaps slots, clears draft; a PUT arriving during the swap writes to whatever `draft` is after the swap (so the new draft reflects the just-committed baseline). Racy but not data-damaging. Tested by hammering both endpoints with 100 interleaved calls and checking post-state consistency.

### Parity + math
- **Order-invariance.** Assert that inserting correlation entries in different orders (shuffle-randomised) produces byte-identical matrices after materialisation (the canonical-key canon ensures this).
- **Symmetry.** Assert `materialise_matrix(entries).T == materialise_matrix(entries)` for every test fixture.
- **Non-determinism guard.** Stage H sorts the (symbol, expiry) axes before pivoting to numpy, so process hash-order drift (per `tasks/lessons.md`) doesn't leak into the inversion.

## Out of Scope

- **Cross-dimension correlations** (e.g. `ρ(BTC-28MAR, ETH-25APR)` distinct from the Kronecker `ρ(BTC,ETH) × ρ(28MAR,25APR)`). Requires a full k·m × k·m matrix. Deferred — log as a follow-up in `tasks/todo.md`.
- **Tikhonov / ridge regularisation.** Explicitly out — user chose "fail loudly" over silent regularisation. Revisit only if singular-matrix errors become a frequent support load.
- **L1 / L2 minimisation objective.** Out — direct inversion confirmed. See `docs/decisions.md` entry on the day of implementation.
- **Correlation-matrix versioning / audit trail.** Out beyond the per-`PositionHistoryPoint` snapshot. A dedicated `correlation_history` table is a future concern.
- **LLM-assisted correlation authoring** ("Build mode set these correlations based on realized co-movement"). Out — this is a Build-orchestrator follow-up, not a pipeline change.
- **Upload matrix from CSV.** Out — paste into the editor is fine for k, m ≤ 30.
- **Persistent draft across sessions.** Out — drafts are per-server-process; user loses them on page reload or server restart. Not worth localStorage plumbing yet.
- **Dedup / reference-counting of history snapshot matrices.** Out — full copy per point (~6 KB) is acceptable until k > 50.

---

## Implementation milestones (ordered)

1. **Milestone 0 — `PositionDelta` → `PositionDiff` rename.** One commit. Typecheck + compileall green.
2. **Milestone 1 — Pydantic + TS models.** Add all correlation models + extend `DesiredPosition`. Typecheck both. One commit.
3. **Milestone 2 — `CorrelationStore` + router.** Add storage + eight routes. Integration test: GET empty → 200; PUT draft → GET draft non-null → POST confirm → GET committed updated. One commit.
4. **Milestone 3 — Stage H transform + pipeline integration.** Add `exposure_to_position.py`, register in transforms, wire into `pipeline.py`. Parity test: identity matrices → output unchanged. One commit.
5. **Milestone 4 — Engine state + WS plumbing.** `engine_state.py` reads the stores; `ws.py` dirty-flag check; `ws_serializers.py` emits the four new columns. Manual test: PUT draft → WS broadcast carries `*_hypothetical`. One commit.
6. **Milestone 5 — Position history with matrices.** Extend `PositionHistoryPoint`; wire through `position_history.build_from_desired_pos_df`. Test: history captures matrices at each push. One commit.
7. **Milestone 6 — Anatomy DAG node.** `anatomyGraph.ts` + `buildAnatomyGraph.ts` + `CorrelationsNode.tsx` + selection routing. Visual test in `./start.sh`. One commit.
8. **Milestone 7 — Correlations editor.** `CorrelationsEditor.tsx` + `MatrixGrid.tsx` + `ConfirmMatrixModal.tsx` + `useCorrelationsDraft.ts` hook. Manual test: edit, preview updates live, confirm, discard. One commit.
9. **Milestone 8 — Grid view modes + CellInspector integration.** New "Exposure" view modes + "draft" annotations. One commit.
10. **Milestone 9 — Singularity error surfacing.** `CorrelationSingularAlert` + Notifications Center rendering. Test: enter `ρ=1.0` → error card + Confirm disabled. One commit.
11. **Milestone 10 — Documentation sync.** `docs/architecture.md`, `docs/decisions.md`, `docs/stack-status.md`, `docs/product.md`. One commit.

Each milestone is independently committable. Run verification (`python -m compileall server/ -q` + `npm --prefix client/ui run typecheck`) at the end of every milestone. Any milestone that breaks verification blocks the next.

---

**End of spec.** Implementation starts with Milestone 0 in a fresh session.
