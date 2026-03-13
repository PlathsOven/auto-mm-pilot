# MVP Notebook Rewrite Plan (`mvp_new_gpt.ipynb`)

## Objective

Create a new notebook, `prototyping/mvp_new_gpt.ipynb`, that preserves the conceptual pipeline from `mvp.ipynb` while improving:

- readability
- maintainability
- elegance
- modularity
- ease of sensechecking
- ease of swapping inputs and testing scenarios

This plan is based on a review of:

- `AGENTS.md`
- `README.md`
- `prototyping/requirements.txt`
- `prototyping/mvp.ipynb`

## Scope

- Lane: `prototyping/`
- Planned output notebook: `prototyping/mvp_new_gpt.ipynb`
- This document is a planning artifact only. It does not implement the notebook.

## Current Notebook Assessment

### High-level verdict

The current notebook has a strong conceptual model but a fragile implementation shape.

It captures the right business decomposition:

- stream ingestion
- raw-to-target-space conversion
- temporal space assignment
- per-block fair value and variance construction through time
- aggregation across spaces
- desired position derivation
- visual sensechecking

However, the implementation is harder to maintain and modify than it should be for a prototype notebook that is meant to evolve quickly.

### What is already good

- The notebook reflects real domain concepts through `DataStream` and `ValueBlock`.
- The pipeline is end-to-end rather than a disconnected formula demo.
- The plotting section is useful for intuition and validation.
- The parameterization direction is good: `size_type`, `aggregation_logic`, and `temporal_position` are meaningful abstractions.

## Main Maintainability and Elegance Issues

### Hidden mutable state

`DataStream` repeatedly mutates its internal `snapshot` via methods such as:

- `update_snapshot`
- `add_market_value`
- `get_value_blocks`

This makes it hard to reason about the current state of a stream and increases notebook order dependence.

### Objects stored inside DataFrames

The notebook stores `ValueBlock` instances inside Polars `Object` columns. That is convenient short-term, but it is not ideal for:

- transparency
- debugging
- serialization
- testing
- explicit pipeline reasoning

### Stringly-typed dynamic columns

Many downstream operations rely on dynamically generated names like:

- `{block_name}_fair`
- `{block_name}_var`
- `market_{block_name}_fair`

This makes the implementation brittle and harder to audit.

### Logic spread across too many shapes

Important rules are split across:

- class methods
- procedural notebook cells
- aggregation loops
- plotting cells

That makes the real pipeline harder to read at a glance.

### Aggregation logic is duplicated

The notebook computes aggregation logic in the main pipeline and again in the sensecheck plotting section. That duplication invites drift and inconsistency.

### Notebook-order dependence

The current design relies heavily on globals and earlier mutations. Re-running cells out of order is more likely to break assumptions or create confusing states.

### Mixed concerns

Business logic, mock data generation, scenario config, execution, and plotting are interleaved. This makes it harder to:

- test one layer independently
- replace example inputs cleanly
- inspect intermediate outputs

### Non-deterministic examples

The use of `random.random()` makes it harder to compare runs and sensecheck changes over time.

### Validation is too implicit

There are some assertions and `ValueError`s, but not enough structured validation around:

- missing columns
- duplicate keys
- null assumptions
- inconsistent market values within a space
- zero or negative variance edge cases

### Performance and readability tradeoff is poor

Nested loops over grouped frames, streams, and rows are acceptable for a first prototype, but the resulting logic is harder to inspect and extend.

### Naming load is too high

Terms like:

- `fair`
- `fair_annualized`
- `total_value`
- `target_value`
- `target_market_value`

are meaningful, but the notebook lacks a central glossary and consistent staging that would make them easy to follow.

## Elegance Verdict

The current notebook is:

- strong on ideas
- medium on readability
- weak on editability
- weak on auditability

## Implementation Constraint

Per the project rules in `AGENTS.md` and `.windsurfrules`, the core mathematical and decision-making logic remains human-owned.

That means any rewrite must avoid authoring or refactoring the proprietary core trading logic directly.

In practice, this means the new notebook should focus on structure, scaffolding, clarity, testing ergonomics, and explicit hook points for human-authored logic.

## Proposed Rewrite Strategy

### Guiding principle

The new notebook should be easy for a Python scripter to edit confidently without needing to trace state across many hidden object mutations.

### Primary design goals

- Make the pipeline narrative and explicit.
- Separate configuration from computation.
- Separate computation from plotting.
- Keep intermediate outputs visible and easy to inspect.
- Make scenario inputs deterministic and easy to replace.
- Make the core hook points obvious for human logic.

## Proposed Notebook Structure

### 1. Notebook purpose and glossary

Start with a plain-English explanation of:

- risk dimension
- space
- stream
- target-space conversion
- fair value
- market-implied value
- variance
- edge
- desired position

This section should reduce terminology ambiguity before any code appears.

### 2. Scenario configuration cell

Create one clean input section for:

- `now`
- `expiry`
- `symbol`
- bankroll or sizing controls
- time-grid resolution
- example market assumptions
- deterministic example stream values

This should be the main place for plugging in test scenarios.

### 3. Stream specification tables

Represent stream setup in a declarative form rather than as heavily stateful objects.

For example, each stream should clearly specify:

- stream name
- key columns
- temporal behavior
- aggregation logic
- conversion parameters or hook name
- variance policy or hook name

This makes it easy to add or modify streams.

### 4. Data normalization helpers

Add pure helper functions for:

- required column validation
- timestamp normalization
- market join validation
- duplicate key checks
- deterministic scenario preparation

These should return explicit DataFrames rather than mutating hidden state.

### 5. Target-space conversion hooks

Provide clearly named hook functions for converting raw values and raw market values into the target space.

These hooks should be easy to edit independently and called from one obvious place in the pipeline.

### 6. Fair-value-through-time hooks

Provide one clearly isolated section for converting target-space values into fair-value paths through time.

This section should be organized around explicit inputs and outputs, not implicit object state.

### 7. Variance construction hooks

Provide a similarly isolated section for variance construction from fair value or other relevant inputs.

### 8. Space-level aggregation

Aggregate each space in one canonical computation path. Avoid duplicating aggregation logic later in the notebook.

The notebook should produce one authoritative table for:

- per-block fair
- per-block variance
- per-space fair
- per-space market fair
- per-space edge
- per-space variance
- total edge
- total variance

### 9. Desired position calculation

Use one explicit section to derive desired position from the aggregate outputs.

This section should make assumptions like smoothing clearly configurable and easy to turn on or off.

### 10. Sensecheck tables before charts

Before plotting, show compact summary tables that make it easy to audit:

- stream inputs
- converted target-space values
- space assignments
- per-space totals
- rows with nulls or suspicious values

### 11. Plotting layer

Build charts only from the canonical output tables, not from duplicated recomputation logic.

## Specific Implementation Improvements

### Replace object-heavy design with explicit data flow

Instead of embedding `ValueBlock` objects inside tables, prefer explicit structures and pure functions. This improves clarity and makes intermediate values easier to inspect.

### Prefer canonical long-form or clearly staged tables

Rather than proliferating many dynamically named columns, aim for a shape that is easier to inspect and group. If wide tables are needed for charts, derive them from a more canonical intermediate form.

### Reduce dynamic naming dependence

Minimize business logic that depends on generated column names. Where naming is necessary, keep it localized to one transformation layer.

### Make examples deterministic

Use fixed example inputs instead of random values so that the notebook is easier to sensecheck and compare across revisions.

### Add validation checkpoints

Introduce explicit checks for:

- required columns present
- timestamp ordering
- duplicate stream keys
- inconsistent market assignments by space
- negative variance
- zero variance before division
- null outputs in critical columns

### Make the notebook rerunnable

The notebook should be safe to rerun from top to bottom without depending on hidden mutation from prior execution.

## Planned File Changes

### Create

- `/Users/seangong/Documents/Projects/auto-mm-pilot/prototyping/mvp_new_gpt.ipynb`

### No other file changes planned

At this planning stage, no updates are planned for:

- `AGENTS.md`
- `README.md`
- dependencies

## Dependency Impact

No new dependencies are planned.

The rewrite should stay within the current prototype stack:

- standard library
- `polars`
- `plotly`

## Mapping to MVP Pipeline

Per `AGENTS.md`, the relevant MVP pipeline stages are:

- Step 4: target space unit conversion
- Step 5: timestamp × fair value
- Step 6: desired position simulation

The proposed notebook rewrite improves these steps by making them structurally explicit:

### Step 4: Target space unit conversion

The rewrite will centralize stream conversion logic into obvious editable hooks and validation checkpoints.

### Step 5: Timestamp × fair value

The rewrite will organize fair-value-through-time construction into a dedicated, easier-to-read layer with explicit inputs and outputs.

### Step 6: Desired position simulation

The rewrite will centralize total edge, total variance, and desired position derivation in one canonical path rather than spreading the logic across multiple notebook sections.

## Expected Outcome

If executed, the new notebook should be:

- easier to read top to bottom
- easier to modify safely
- easier to sensecheck
- easier to test with different stream inputs
- easier to extend with new spaces or streams
- more suitable for a human to build proprietary logic on top of

## Execution Notes

The review concluded that the current notebook has the right conceptual ingredients but needs a cleaner structural shape.

The proposed next implementation step would be to create `prototyping/mvp_new_gpt.ipynb` as a cleaner scaffolded notebook focused on:

- explicit pipeline stages
- deterministic examples
- validation checkpoints
- canonical outputs
- improved plotting separation
- obvious human-owned logic hook points

## Status

- Assessment completed
- Plan documented
- Notebook rewrite not yet implemented
