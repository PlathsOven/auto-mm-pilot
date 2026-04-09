# Product — APT Theory

> This document contains the product theory previously at the top of `README.md`. `README.md` is now the operator's guide; this file holds the "why".

## The Problem

Every market-making firm's PnL decomposes into three multiplicative factors:

**PnL = Market Edge x Edge Share x Edge Retention**

**Market Edge** is how much mispricing exists in the market you've chosen. **Edge Share** is the fraction you capture through execution speed and queue priority. **Edge Retention** is the fraction you keep after managing your resulting position over time.

Market selection and execution infrastructure are well-understood problems. Edge Retention — specifically long-term position management — is not. Today, position management is a senior trader staring at a screen, mentally synthesising multiple data feeds (realized vol, scheduled events, historical IV percentiles, funding rates, cross-asset correlations) into a single decision: how much should we be long or short, and in what?

This does not scale. It is not transferable. It walks out the door when the trader leaves. And it is the single highest-leverage factor in determining whether a desk is profitable.

Crypto options market-making desks are the natural starting point for two reasons. First, crypto markets run 24/7 — there is no closing bell, no overnight break. Continuous coverage is not optional; it is a structural requirement. Automation is not a luxury here, it is the only way to maintain consistent position management across a cycle that never pauses. Second, crypto options is a nascent field. Unlike equities or rates desks with decades of accumulated institutional knowledge, crypto desks have far less positional expertise to draw from. APT fills that gap — providing a formal, transferable framework for position management that would otherwise take years of senior-trader experience to develop organically.

APT replaces this process with a formal, configurable engine that makes the same decision — continuously, explainably, and without key-person risk.

---

## A General Unifying Theory of Trading

APT is built on a single claim: every positional trading decision reduces to the same equation.

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

Market Implied is the market's current pricing, converted to the same units as Fair Value for direct comparison. Edge is the difference.

### Time

Time affects every part of the calculation. Some signals represent ongoing shifts in the expectation of future realised volatility — they roll forward continuously. Others are discrete events anchored to specific timestamps (FOMC, CPI, earnings). Decaying signals start at full strength and shrink over their lifetime, modelling how short-term edges erode as the market corrects an inefficiency.

Forward smoothing handles execution constraints: we cannot assume we can instantly reposition. The executable desired position adjusts gradually toward the ideal, reflecting real-world liquidity limitations.

---

## How the Engine Thinks: Epistemology of the Pipeline

The equation `Desired Position = Edge x Bankroll / Variance` is the destination. The epistemology is how we get there — how the engine forms beliefs about fair value, quantifies its own uncertainty, and translates both into a position.

### Streams, Blocks, and Spaces

The engine's inputs are **data streams** — any source that expresses a view on fair value. Each stream (realized vol, a scheduled FOMC event, a historical IV percentile reading, a funding rate) is defined by a `StreamConfig` that specifies:

- **Target-space mapping** (`scale`, `offset`, `exponent`): how the stream's raw value converts to the engine's internal units. This is a simple polynomial transform: `target = (scale * raw + offset) ^ exponent`.
- **Block configuration**: how the stream distributes its value through time (detailed below).

Each stream produces one or more **blocks** — the atomic unit of value contribution. A stream keyed by `[symbol, expiry, event_id]` produces a separate block for each unique combination. Blocks are grouped into **spaces** — temporal windows that share a common market-implied value. A shifting stream (rolling realized vol) occupies a single "shifting" space. A static stream (a specific FOMC meeting) gets its own space anchored to its event timestamp.

### How Fair Value Is Built

Each block distributes fair value across a time grid from now to expiry. The shape of this distribution is controlled by the block's parameters:

- **Annualized vs. discrete** (`annualized`): Annualized streams spread their value proportionally over time-to-expiry — a 2% annualized vol view on a 6-month expiry contributes half as much total value as the same view on a 1-year expiry. Discrete (non-annualized) streams carry a fixed total value regardless of time-to-expiry — suitable for event-sized shocks.
- **Fixed vs. relative** (`size_type`): Fixed streams contribute their target value directly. Relative streams contribute the difference between their target value and the market-implied value — they express a view relative to current market pricing.
- **Static vs. shifting** (`temporal_position`): Static blocks are anchored to a specific start timestamp (e.g. when an event window opens). Shifting blocks roll forward with the current time — they always start at "now."
- **Decay** (`decay_end_size_mult`, `decay_rate_prop_per_min`): A block can decay from its start size to a smaller end size over its lifetime. This models how short-term edges erode — the initial market reaction to a signal (start size) fades toward the longer-term fundamental change the signal implies (end size). A `decay_end_size_mult` of 1.0 means no decay; 0.0 means the signal decays to nothing.

At each timestamp in the grid, the block's contribution to fair value is its annualized value at that point multiplied by the remaining time-to-expiry (in year-fractions). The annualized value interpolates linearly between the start and end values for annualized streams, or stays constant for discrete streams.

Market-implied fair value is computed identically — same block shape, same temporal distribution — but using the market's current pricing as input instead of the stream's target value. This ensures fair value and market-implied are always in the same units and directly comparable.

### How Blocks Aggregate

Within each space, blocks aggregate according to their `aggregation_logic`:

- **Average**: blocks are averaged together. This is consensus — if three realized vol streams say 20%, 22%, and 21%, the space's fair contribution is their mean. This is how you blend multiple estimates of the same quantity.
- **Offset**: blocks are summed. This is for independent additive layers — a funding rate signal stacks on top of a vol signal rather than averaging with it.

Each space produces a `space_fair` (average component + offset component) and a `space_market_fair`. Edge per space is `space_fair - space_market_fair`. Total edge across all spaces is summed.

### How Variance Is Computed

Variance for each block is `abs(fair) * var_fair_ratio`, where `var_fair_ratio` is the stream's confidence weight. This encodes a specific epistemic claim: **uncertainty scales with the size of the estimate**. A stream contributing a large fair value also contributes large variance — a bigger estimate means more room to be wrong. A stream the desk trusts more gets a lower `var_fair_ratio`, reducing its variance contribution relative to its fair value contribution, and thereby increasing the position size it can drive.

Total variance is summed across all blocks (no averaging — variances add, even within average-aggregated spaces). This means adding more streams always increases total variance, which tempers position size. More information is not free; it comes with more uncertainty to manage.

### Forward Smoothing and Execution

The raw desired position (`edge * bankroll / var`) assumes we can instantly reposition. We cannot. Edge and variance are each independently smoothed using a forward-looking exponentially weighted mean (EWM) with a configurable half-life. The smoothed desired position is then `smoothed_edge * bankroll / smoothed_var`.

When the smoothed position is close to the raw position, it means the contributors to edge and variance are expected to remain mostly similar looking forward — we don't expect to need much repositioning. When they diverge, we are liquidity-constrained and the executable position is lagging the ideal.

### The LLM Explanation Layer

The engine produces numbers. The LLM layer produces understanding. It receives the full pipeline state — per-block contributions, aggregated edge and variance, raw and smoothed positions — and translates this into plain trading language. It follows a strict reasoning chain: (1) did edge or variance drive the change? (2) which specific stream? (3) what happened in that stream? (4) how did fair value and market-implied compare? (5) what is the directional effect on position?

The LLM also handles the reverse path: a trader says "freeze BTC near-dated exposure" or "increase bankroll to 5M", and the system parses this into a structured engine command — but only after explicit confirmation. This closes the loop between automated computation and human judgment.
