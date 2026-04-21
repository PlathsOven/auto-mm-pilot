# Product — Posit Theory

> This document contains the product theory previously at the top of `README.md`. `README.md` is now the operator's guide; this file holds the "why".

## The Problem

Every market-making firm's PnL decomposes into three multiplicative factors:

**PnL = Market Edge x Edge Share x Edge Retention**

**Market Edge** is how much mispricing exists in the market you've chosen. **Edge Share** is the fraction you capture through execution speed and queue priority. **Edge Retention** is the fraction you keep after managing your resulting position over time.

Market selection and execution infrastructure are well-understood problems. Edge Retention — specifically long-term position management — is not. Today, position management is a senior trader staring at a screen, mentally synthesising multiple data feeds (realized vol, scheduled events, historical IV percentiles, funding rates, cross-asset correlations) into a single decision: how much should we be long or short, and in what?

This does not scale. It is not transferable. It walks out the door when the trader leaves. And it is the single highest-leverage factor in determining whether a desk is profitable.

Crypto options market-making desks are the natural starting point for two reasons. First, crypto markets run 24/7 — there is no closing bell, no overnight break. Continuous coverage is not optional; it is a structural requirement. Automation is not a luxury here, it is the only way to maintain consistent position management across a cycle that never pauses. Second, crypto options is a nascent field. Unlike equities or rates desks with decades of accumulated institutional knowledge, crypto desks have far less positional expertise to draw from. Posit fills that gap — providing a formal, transferable framework for position management that would otherwise take years of senior-trader experience to develop organically.

Posit replaces this process with a formal, configurable engine that makes the same decision — continuously, explainably, and without key-person risk.

---

## A General Unifying Theory of Trading

Posit is built on a single claim: every positional trading decision reduces to the same equation.

```
Desired Position = Edge x Bankroll / Variance
```

- **Edge** is Fair Value minus Market Implied — how much we think the market is mispricing something, and in which direction.
- **Variance** is the uncertainty of our fair value estimate. It scales with the absolute size of that estimate, weighted by our confidence in each contributing data source. Larger estimates mean more room to be wrong in absolute terms.
- **Bankroll** is the capital allocated to the strategy.

This is the entire theory. Position size is proportional to how much edge we see, and inversely proportional to how uncertain we are about it. Everything else — the data streams, the temporal logic, the cross-asset correlations — is infrastructure for computing Edge and Variance well.

### Signal Synthesis

Fair Value is not a single number from a single source. It is synthesised from multiple independent data streams, each expressing a view on what an asset should be worth. Realized vol, scheduled macro events, historical IV percentiles, funding rates, cross-asset correlation shifts — any data source that can be expressed as a view on fair value can be plugged into the engine as a configurable stream.

Each stream is parameterised by how it maps into a common target space, how it distributes its impact through time, how it aggregates with other streams (blending into a consensus or stacking as an independent additive layer), and its confidence weight (how much the desk trusts this particular signal). The engine does not privilege any stream — the framework is agnostic to the source. What matters is the parameterisation.

Market-implied value lives at the **space** level, not per block. One market value per `(symbol, expiry, space_id)` flows through the `market_value_inference` step, which produces a `market_fair(t)` curve shaped proportional to the space's own `fair(t)`. Edge is the difference `total_fair − total_market_fair` at the `(symbol, expiry)` aggregate. When no aggregate or per-space market value is set, the engine defaults `market_fair = fair` at every timestamp, producing zero edge by construction — the desk sees "no position" rather than "stale fallback position."

### Time

Time affects every part of the calculation. Some signals represent ongoing shifts in the expectation of future realised volatility — they roll forward continuously. Others are discrete events anchored to specific timestamps (FOMC, CPI, earnings). Decaying signals start at full strength and shrink over their lifetime, modelling how short-term edges erode as the market corrects an inefficiency.

Forward smoothing handles execution constraints: we cannot assume we can instantly reposition. The executable desired position adjusts gradually toward the ideal, reflecting real-world liquidity limitations.

---

## How the Engine Thinks: Epistemology of the Pipeline

The equation `Desired Position = Edge x Bankroll / Variance` is the destination. The epistemology is how we get there — how the engine forms beliefs about fair value, quantifies its own uncertainty, and translates both into a position.

### Streams, Blocks, and Spaces

The engine's inputs are **data streams** — any source that expresses a view on fair value. Each stream (realized vol, a scheduled FOMC event, a historical IV percentile reading, a funding rate) is defined by a `StreamConfig` that specifies:

- **Raw→calc mapping** (`scale`, `offset`, `exponent`): how the stream's raw value converts to the engine's calculation space — whatever is linear in what we price (for options today, variance units). Default transform: `(scale * raw + offset) ^ exponent`. A separate global `calc_to_target` step maps calculation space to target space — the axis the trader reads (annualised vol points for options).
- **Applies to** (`applies_to`): the list of `(symbol, expiry)` pairs the stream's blocks fan out to. `None` (default) means "every pair in the pipeline's dim universe", so a single event block can cover every dim at once instead of needing N duplicates.
- **Block configuration**: how the stream distributes its value through time (detailed below).

Each stream produces one or more **blocks** — the atomic unit of value contribution. A stream keyed by `[symbol, expiry, event_id]` produces a separate block for each unique combination. Blocks are grouped into **spaces** — independent risk dimensions that share a common market-implied reference. A shifting stream (rolling realized vol) occupies a single "shifting" space. A static stream (a specific FOMC meeting) gets its own space anchored to its event timestamp.

The engine operates across four distinct spaces: **risk** (constituent risk dimensions, e.g. base-vol vs. event-vol), **raw** (whatever units the block is authored in), **calculation** (linear in what we price — variance for options), and **target** (the axis linear in PnL — annualised vol for options). Two transforms bridge raw → calc (`unit_conversion`) and calc → target (`calc_to_target`). This separation is load-bearing: combining independent risk dimensions is a sum (Sharpe combines as √n), combining multiple estimators of the *same* risk is a mean, and edge is linear in PnL only in target space.

### How Fair Value Is Built

Each block distributes fair value across a time grid from now to expiry. The shape of this distribution is controlled by the block's parameters:

- **Annualized vs. discrete** (`annualized`): Annualized streams spread their value proportionally over time-to-expiry — a 2% annualized vol view on a 6-month expiry contributes half as much total value as the same view on a 1-year expiry. Discrete (non-annualized) streams carry a fixed total value regardless of time-to-expiry — suitable for event-sized shocks.
- **Static vs. shifting** (`temporal_position`): Static blocks are anchored to a specific start timestamp (e.g. when an event window opens). Shifting blocks roll forward with the current time — they always start at "now."
- **Decay** (`decay_end_size_mult`, `decay_rate_prop_per_min`): A block can decay from its start size to a smaller end size over its lifetime. This models how short-term edges erode — the initial market reaction to a signal (start size) fades toward the longer-term fundamental change the signal implies (end size). A `decay_end_size_mult` of 1.0 means no decay; 0.0 means the signal decays to nothing.

Stage B of the pipeline runs the `unit_conversion` transform on the block's three raw scalars (`raw_fair`, `raw_var`, `raw_market`) to produce three calc-space totals, then distributes each total across the block's live window via the `temporal_fair_value` transform. Rows outside `[start_timestamp, expiry]` are **omitted**, not zeroed, so downstream averaging only sees live contributors.

### How Blocks Aggregate

Blocks within the same `(symbol, expiry, space_id)` are treated as **estimators of the same risk**: Stage C averages their per-timestamp fair / var / market contributions. Multiple blocks on the same space improve the estimate without inflating position size — three realized-vol estimators on BTC Q1 combine as a mean, not a sum.

Blocks in **different spaces** on the same `(symbol, expiry)` are treated as **independent risk dimensions**: Stage D.2 sums across spaces. Base vol and event vol on the same expiry both contribute to total position size — they're not competing estimators, they're separate things to be exposed to.

`space.market_fair(t)` carries the shared market-implied reference for each space. Blocks authoring their own `market_value` contribute to the mean directly; blocks tagged `aggregate` leave it null so `market_value_inference` can fill it proportional to `space_fair(t)` given the user's aggregate `total_vol`; blocks tagged `passthrough` set `market = fair` so they contribute zero edge by construction (the safe no-view default).

After the space-mean → sum chain, Stage E applies the selected `calc_to_target` transform (default `annualised_sqrt`: forward-integrate + annualise + sqrt × 100) to lift `total_fair_calc`, `total_var_calc`, `total_market_fair_calc` into target space. Edge is computed in target space directly: `edge = total_fair − total_market_fair`.

### How Variance Is Computed

Variance for each block is computed in raw space during Stage A. Default transform `fair_proportional`: `raw_var = |raw_fair| * var_fair_ratio`, where `var_fair_ratio` is the stream's confidence weight. This encodes a specific epistemic claim: **uncertainty scales with the size of the estimate**. A stream contributing a large fair value also contributes large variance — a bigger estimate means more room to be wrong. A stream the desk trusts more gets a lower `var_fair_ratio`, reducing its variance contribution relative to its fair value contribution, and thereby increasing the position size it can drive. Alternative variance transforms (`constant`, `squared_fair`) are available for sources whose noise profile is different.

Variances combine consistently with the space model: **average within a space** (estimators of the same risk converge), **sum across spaces** (independent risks add). Adding a second independent risk always increases total variance, which tempers position size. Adding a second estimator of an existing risk keeps total variance roughly the same. More information is not free; more *kinds* of risk cost more than more *data* on the same risk.

### Forward Smoothing and Execution

The raw desired position (`edge * bankroll / var`) assumes we can instantly reposition. We cannot. Edge and variance are each independently smoothed using a forward-looking exponentially weighted mean (EWM) with a configurable half-life. The smoothed desired position is then `smoothed_edge * bankroll / smoothed_var`.

When the smoothed position is close to the raw position, it means the contributors to edge and variance are expected to remain mostly similar looking forward — we don't expect to need much repositioning. When they diverge, we are liquidity-constrained and the executable position is lagging the ideal.

### The LLM Explanation Layer

The engine produces numbers. The LLM layer produces understanding. It receives the full pipeline state — per-block contributions, aggregated edge and variance, raw and smoothed positions — and translates this into plain trading language. It follows a strict reasoning chain: (1) did edge or variance drive the change? (2) which specific stream? (3) what happened in that stream? (4) how did total fair value compare against the aggregate market-implied reference? (5) what is the directional effect on position?

The LLM also handles the reverse path: a trader says "freeze BTC near-dated exposure" or "increase bankroll to 5M", and the system parses this into a structured engine command — but only after explicit confirmation. This closes the loop between automated computation and human judgment.
