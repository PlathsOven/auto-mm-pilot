# Spec: LLM Opinion + Configure Prompts

## Overview

Replace the stub system prompts in `opinion.py` and `configure.py` with full, production-quality prompt content that guides the LLM through a structured 4-step decision flow. The LLM must be able to take a trader's natural-language opinion (or data-stream description) and produce a complete `engine-command` block with all parameters needed to create a manual block or configure a data stream.

## Requirements

### User stories

- As a **trader**, I want to state an opinion in natural language ("I think FOMC will be an upset") and have the LLM walk me through the right questions to turn it into a manual block, so that my discretionary views are reflected in desired positions without me needing to understand `BlockConfig` parameters.
- As a **trader**, I want to describe a new data stream I have access to and have the LLM determine whether it can feed the pipeline, what conversion parameters are needed, and set it up — so that onboarding new data sources doesn't require engineering knowledge.
- As a **trader**, I want to be told clearly when my data source can't be converted to variance units, with suggestions for what I could provide instead — so that I don't waste time on incompatible data.

### Acceptance criteria

- [ ] Opinion mode: LLM can guide a user from "I think FOMC will move BTC by 5%" to a complete `create_manual_block` engine-command with correct `scale=√(π/2)/100`, `exponent=2`, `annualized=false`, `aggregation_logic=offset`, `temporal_position=static`, `decay_end_size_mult=0.0`, and a user-specified `decay_rate_prop_per_min`.
- [ ] Opinion mode: LLM can guide "I think vols will get bid to 50" to a `create_manual_block` with `scale=0.01`, `exponent=2`, `annualized=true`, `aggregation_logic=average`, `temporal_position=shifting`, `decay_end_size_mult=1.0`.
- [ ] Opinion mode: LLM presents available symbols/expiries from engine state for selection (does not offer symbols/expiries not in the engine).
- [ ] Opinion mode: LLM supports multi-expiry blocks by constructing snapshot rows for each selected expiry.
- [ ] Opinion mode: LLM warns when an existing manual block already covers the same symbol/expiry before emitting a command.
- [ ] Configure mode: LLM can guide a realized-vol data stream description to a `create_stream` engine-command with correct conversion and block parameters.
- [ ] Configure mode: LLM rejects data that cannot be converted to variance (e.g., raw spot price) with a reasoned explanation and suggestions for vol-related alternatives.
- [ ] Configure mode: LLM supports both base-vol and event-vol stream classifications.
- [ ] Both modes: LLM confirms all parameters with the trader before emitting the engine-command block.
- [ ] Both modes: LLM asks batched questions when answers are independent, and sequential questions when one answer determines the next.
- [ ] Both modes: Intent mismatch detection — if the trader asks an investigation question, the LLM flags it and suggests switching modes.

### Performance

- Cold path only (per-request, not per-tick). No latency constraints beyond normal LLM response time.
- Prompt size must stay reasonable — the shared sections + mode extension + dynamic data should not exceed ~4,000 tokens of system prompt.

### Security

- No new endpoints. No auth changes. Prompts do not expose API keys or internal implementation details.
- Engine-command blocks are emitted as formatted text in the LLM response — they are **not** auto-executed server-side. The client is responsible for parsing and executing (see Spec 2).

## Technical Approach

Both modes share a common 4-step decision flow. The shared logic is extracted into new constants in `core.py` and imported by both mode files. Each mode file adds its own framing, conversational protocol, and examples.

The prompt composition for each mode:

```
SHARED_CORE (role, framework, constraints, language rules, response discipline)
+ PARAMETER_MAPPING (existing — parameter ↔ trading intent bridge)
+ BLOCK_DECISION_FLOW (new — the 4-step protocol: WHAT to determine)
+ UNIT_CONVERSION_REFERENCE (new — common patterns with exact values)
+ BASE_VS_EVENT_RULES (new — classification rules with parameter sets)
+ MODE_EXTENSION (opinion-specific or configure-specific delta ONLY)
+ DYNAMIC DATA (engine state, stream contexts)
```

**Layering principle:** The shared sections define the complete decision protocol, conversion math, and classification rules. The mode extensions must NOT restate any of this. They contain only: (a) the mode mandate, (b) mode-specific entry point and conversational framing, (c) mode-specific edge cases (multi-expiry, rejection, conflict detection), (d) engine-command format, (e) worked examples. They reference the shared protocol with "follow the BLOCK_DECISION_FLOW" rather than restating the steps.

### New shared constants in `core.py`

#### `BLOCK_DECISION_FLOW`

The 4-step decision protocol the LLM must follow:

**Step 1 — Identify target dimensions.** Determine which symbol(s) and expiry/expiries the opinion or data applies to. Present available options from the engine state. A single block can span multiple symbol/expiry combinations — each becomes a row in the snapshot.

**Step 2 — Quantify in vol-related units.** Ensure the view is expressed as a number in vol-related units. The exact question to ask depends on what they're describing:
- "FOMC will be an upset" → "What absolute % move in BTC do you expect on average?"
- "Vols will get bid" → "What vol level do you think vols will get bid to?"
- "Realized vol is running hot" → "What annualized vol level?"

If the input is a data stream, steps 1 and 2 are provided by the data itself — the LLM focuses on understanding the data's semantics.

**Step 3 — Determine unit conversion.** Map the user's units into variance (the pipeline's internal unit) by determining `scale`, `offset`, `exponent`, and `annualized`. Use the conversion reference table for known patterns. For novel patterns, derive from first principles: target = (scale × raw + offset)^exponent, where target must be in variance units (σ²). If the data cannot be converted to variance through any reasonable transform, reject with explanation and suggestions.

**Step 4 — Classify base vol vs event vol.** Determine the temporal nature:
- **Event vol:** discrete period of higher realized vol → `aggregation_logic=offset`, `temporal_position=static`, `annualized=false`, `decay_end_size_mult=0.0`, requires `start_timestamp` and `decay_rate_prop_per_min`.
- **Base vol:** ongoing vol level between now and expiry → `aggregation_logic=average`, `temporal_position=shifting`, `annualized=true`, `decay_end_size_mult=1.0`.

Also ask about confidence (`var_fair_ratio`): how much does the trader trust this view relative to others? Default 1.0; lower = more confident.

#### `UNIT_CONVERSION_REFERENCE`

A reference table of common data types with exact conversion parameters:

| Data Type | User Says | raw_value | scale | offset | exponent | annualized | Notes |
|-----------|-----------|-----------|-------|--------|----------|------------|-------|
| Annualized vol level (%) | "50 vol" | 50 | 0.01 | 0 | 2 | true | %→decimal→variance |
| Annualized vol level (decimal) | stream: 0.50 | 0.50 | 1.0 | 0 | 2 | true | decimal→variance |
| Expected absolute % move | "5% FOMC move" | 5 | √(π/2)/100 ≈ 0.01253 | 0 | 2 | false | E[\|ret\|]→σ→variance |
| Expected absolute move (decimal) | stream: 0.05 | 0.05 | √(π/2) ≈ 1.2533 | 0 | 2 | false | E[\|ret\|]→σ→variance |
| IV level (%) | "IV at 60%" | 60 | 0.01 | 0 | 2 | true | Same as vol level |
| Realized variance (decimal) | stream: 0.2025 | 0.2025 | 1.0 | 0 | 1 | true | Already variance |

The LLM should use this table for known patterns and derive from first principles for novel ones. The key identity: `target = (scale × raw + offset)^exponent` must produce **variance** (σ²).

#### `BASE_VS_EVENT_RULES`

Classification rules with full parameter mappings:

**Event vol** (discrete time window of higher realized vol):
- Examples: FOMC, CPI, protocol upgrade, earnings
- `annualized = false`
- `aggregation_logic = "offset"` (stacks additively)
- `temporal_position = "static"` (anchored to event time)
- `decay_end_size_mult = 0.0` (decays to nothing after event)
- `decay_rate_prop_per_min` = proportion of remaining event vol that realises per minute
- Requires `start_timestamp` in each snapshot row
- Typical decay rates:
  - FOMC/CPI: ~0.03 (market prices in within ~30 min)
  - Protocol upgrade: ~0.005 (slower, hours)
  - Flash event: ~0.05 (very fast, ~15 min)

**Base vol** (ongoing vol level, not a discrete event):
- Examples: "vols will get bid", "realized vol is running hot", mean-reversion IV view
- `annualized = true`
- `aggregation_logic = "average"` (blends with other base-vol views)
- `temporal_position = "shifting"` (rolls forward with current time)
- `decay_end_size_mult = 1.0` (no decay)
- `decay_rate_prop_per_min = 0.0`
- No `start_timestamp` needed

### `opinion.py` — Full prompt

Replace `OPINION_EXT` with content that covers **only opinion-specific behavior**. The shared sections (`BLOCK_DECISION_FLOW`, `UNIT_CONVERSION_REFERENCE`, `BASE_VS_EVENT_RULES`) already provide the 4-step protocol, conversion table, and classification rules. `OPINION_EXT` must not restate them — it references them with "follow the BLOCK_DECISION_FLOW" and adds only the following:

**OPINION MODE mandate:** Translate a discretionary view into a manual block. Follow the BLOCK_DECISION_FLOW. After confirming all parameters, emit a `create_manual_block` engine-command.

**Opinion-specific entry point:** The conversation starts with the trader's view. Listen for clues about base vs event in their initial statement before entering the decision flow. If they've already specified symbol, expiry, or magnitude in their opening message, skip those steps.

**Multi-expiry handling:** A single opinion can apply to multiple expiries. Construct one snapshot row per (symbol, expiry) combination. All rows share the same `raw_value` and block config unless the trader specifies different magnitudes per expiry.

**Conflict detection:** Before emitting the command, check existing blocks in the engine state. If a manual block already exists for overlapping symbol/expiry, warn: "There's already a manual block [name] covering [symbol] [expiry]. Creating another will stack additively (if offset) or blend (if average). Want to proceed, or update the existing one?"

**Engine-command format:**
```
engine-command
{
  "action": "create_manual_block",
  "params": {
    "stream_name": "<descriptive_name>",
    "key_cols": ["symbol", "expiry"],
    "scale": <float>,
    "offset": <float>,
    "exponent": <float>,
    "block": {
      "annualized": <bool>,
      "size_type": "fixed",
      "aggregation_logic": "<average|offset>",
      "temporal_position": "<static|shifting>",
      "decay_end_size_mult": <float>,
      "decay_rate_prop_per_min": <float>,
      "var_fair_ratio": <float>
    },
    "snapshot_rows": [
      {
        "timestamp": "<ISO 8601 now>",
        "symbol": "<symbol>",
        "expiry": "<ISO 8601>",
        "raw_value": <float>,
        "start_timestamp": "<ISO 8601, events only>"
      }
    ]
  }
}
```

**Naming convention:** `stream_name` should be descriptive: `opinion_<topic>_<symbol>_<YYYYMMDD>` (e.g., `opinion_fomc_btc_20260115`, `opinion_base_vol_eth_20260410`).

**Worked examples to include in the prompt:**

*Example 1 — Event vol:*
> Trader: "I think the FOMC is going to be an upset"
> LLM: "Which symbol and expiry? [presents available]. What absolute % move in BTC do you expect on average? When is the FOMC announcement? How quickly do you think the market will price in the result — within 30 minutes, an hour, or longer?"
> → scale=√(π/2)/100, exponent=2, offset=0, annualized=false, aggregation_logic=offset, temporal_position=static, decay_end_size_mult=0, decay_rate_prop_per_min=0.03, start_timestamp=FOMC time

*Example 2 — Base vol:*
> Trader: "I think vols will get bid to 50"
> LLM: "Which symbol and expiry? [presents available]"
> → scale=0.01, exponent=2, offset=0, annualized=true, aggregation_logic=average, temporal_position=shifting, decay_end_size_mult=1.0, decay_rate_prop_per_min=0.0

### `configure.py` — Full prompt

Replace `CONFIGURE_EXT` with content that covers **only configure-specific behavior**. Same principle — shared sections provide the protocol, conversion table, and classification rules. `CONFIGURE_EXT` must not restate them.

**CONFIGURE MODE mandate:** Onboard a new data stream. Follow the BLOCK_DECISION_FLOW, but with a key difference: for data streams, steps 1 (symbol/expiry) and 2 (value units) come from the data itself — the LLM's job is to understand what the data represents so it can determine steps 3 (conversion) and 4 (classification) correctly.

**Configure-specific entry point:** The conversation starts by asking the trader to describe the data stream: what it measures, its units, update frequency. From this description, determine whether the data is vol-related and can enter the pipeline.

**key_cols determination:** Ask what dimensions the data has (symbol, expiry, event_id, etc.) — this sets the `key_cols` for the stream definition.

**Data stream rejection protocol:** When data cannot be converted to variance:
- Explain clearly: "The pipeline operates in variance units (σ²). [Data type] doesn't have a direct relationship to volatility that can be expressed as `target = (scale × raw + offset)^exponent`."
- Reason about what the data *could* become: "If you computed rolling realized volatility from these spot prices, that *would* be directly convertible."
- Do not reject prematurely — think hard about whether a transform exists. Funding rates, for example, are borderline: they're not vol, but a sustained funding rate imbalance could be modeled as a vol-adjacent signal if the trader has a thesis about the relationship.

**Engine-command format for streams:**
```
engine-command
{
  "action": "create_stream",
  "params": {
    "stream_name": "<descriptive_name>",
    "key_cols": ["symbol", "expiry"],
    "scale": <float>,
    "offset": <float>,
    "exponent": <float>,
    "block": {
      "annualized": <bool>,
      "size_type": "fixed",
      "aggregation_logic": "<average|offset>",
      "temporal_position": "<static|shifting>",
      "decay_end_size_mult": <float>,
      "decay_rate_prop_per_min": <float>,
      "var_fair_ratio": <float>
    }
  }
}
```

Note: no `snapshot_rows` — the data will flow in from the live feed after the stream is created and configured. The client will call the stream creation + configuration endpoints, and then the trader connects their data source.

**Worked examples to include in the prompt:**

*Example 1 — Realized vol stream:*
> Trader: "I have a realized vol feed from Provider X. It gives annualized vol as a decimal (e.g., 0.45) per symbol and expiry, updated every minute."
> LLM: → scale=1.0, exponent=2, offset=0, annualized=true, base vol (average/shifting), key_cols=["symbol", "expiry"]

*Example 2 — Rejection:*
> Trader: "I have a feed of BTC spot prices."
> LLM: "Spot prices can't be directly converted to variance — the pipeline needs vol-related data. However, if you computed rolling realized vol from those spot returns (e.g., annualized standard deviation of log returns over a window), that would be directly convertible. Could you transform the feed on your end, or would you like to set up a manual block with your current vol estimate instead?"

### Data shape changes

None. No changes to `server/api/models.py` or `client/ui/src/types.ts`. The engine-command format uses the existing `ManualBlockRequest` shape (for opinions) and `CreateStreamRequest` + `AdminConfigureStreamRequest` shapes (for streams).

### Files to create

None.

### Files to modify

| File | Change |
|------|--------|
| `server/api/llm/prompts/core.py` | Add `BLOCK_DECISION_FLOW`, `UNIT_CONVERSION_REFERENCE`, `BASE_VS_EVENT_RULES` constants |
| `server/api/llm/prompts/opinion.py` | Replace `OPINION_EXT` stub with full prompt; import + include new shared sections; update `build_opinion_prompt` composition |
| `server/api/llm/prompts/configure.py` | Replace `CONFIGURE_EXT` stub with full prompt; import + include new shared sections; update `build_configure_prompt` composition |

## Test Cases

Test cases are verified by reading the constructed prompt and confirming the LLM would have the information and instructions needed to handle each scenario. Functional verification requires running the LLM with the prompt and a test conversation.

- **Happy path — event opinion:** "I think FOMC on Jan 15 will move BTC by 5%" → prompt guides to: event classification, correct conversion params, start_timestamp, decay rate question, correct engine-command.
- **Happy path — base vol opinion:** "I think ETH vol will get bid to 50 over the next month" → prompt guides to: base classification, correct conversion, no start_timestamp, no decay, correct engine-command.
- **Multi-expiry opinion:** "I think FOMC affects both the Jan 30 and Feb 28 BTC expiries" → snapshot_rows contain two rows with different expiries, same raw_value and config.
- **Conflict warning:** Existing manual block `opinion_fomc_btc_20260115` on BTC/30JAN26 → LLM warns before emitting a second event block on the same dimension.
- **Configure — realized vol stream:** Trader describes decimal annualized vol feed → correct stream command with scale=1.0, exponent=2, base vol classification.
- **Configure — rejection:** Trader describes spot price feed → LLM explains why it can't convert, suggests computing realized vol.
- **Configure — borderline:** Trader describes funding rate data → LLM reasons about whether a vol relationship exists, asks the trader for their thesis.
- **Empty engine state:** No positions/streams → LLM asks the trader to specify symbol and expiry manually (cannot present options).
- **Intent mismatch:** Trader in opinion mode asks "why did my BTC position change?" → LLM flags and suggests switching to Investigate mode.
- **Ambiguous input:** "I have a view on BTC" → LLM asks one clarifying question: "What's your view — is it about vol levels, an expected event move, or something else?"

## Out of Scope

- **Server-side engine-command parsing and execution.** The prompts define the command format; wiring the client to parse and execute is Spec 2.
- **Updating or deleting existing blocks via LLM.** This spec covers creation only. Edit/delete flows are a future pass.
- **`size_type=relative` blocks.** The prompt will use `fixed` for all manual blocks. Relative sizing (view relative to market) is a power-user feature for a later iteration.
- **Custom space_id_override.** The prompt will not expose this — space_id is auto-computed from temporal_position.
- **Stream snapshot ingestion after creation.** Configure mode creates the stream definition; connecting the live data feed is the trader's responsibility via the existing ingestion API.

## Manual Brain Boundary

This feature does not touch `server/core/`. The prompts reference `BlockConfig` and `StreamConfig` semantics (read-only understanding), but all code changes are in `server/api/llm/prompts/`. The conversion formula `target = (scale × raw + offset)^exponent` is documented in `server/core/helpers.py:raw_to_target_expr` — the prompts teach the LLM to use it, but the implementation is untouched.
