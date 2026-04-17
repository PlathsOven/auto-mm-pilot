---
description: UI design workflow grounded in user journey, persona needs, and attention hierarchy
---

## /ui-design — UI Design

Run before implementing any UI change that affects layout, interaction patterns, or information hierarchy. This workflow ensures every design decision is grounded in the trader persona, their minimal essential needs, and how they actually use the terminal.

---

### 1. Context Load

Read these files fully — do not skim:
- `docs/user-journey.md` — personas, core flows, invariants, edge cases
- `client/ui/UI_SPEC.md` — visual identity, zone layout, component specs
- `docs/product.md` — the "why" behind Posit, the Edge x Bankroll / Variance framework
- `docs/conventions.md` — established UI patterns (react-grid-layout, Context providers, named exports, no prop drilling)

If the design task touches a specific component, also read that component file and its provider/service dependencies.

### 2. Persona Grounding

Before proposing anything, restate these five dimensions for the primary persona (quant desk head running a 24/7 crypto options book):

1. **Minimal essential needs** — What does the trader *must* see or do to get value from this screen/component? Strip away everything that is not load-bearing. Reference the specific flow from `docs/user-journey.md` (Flow 1–4) that this task touches.
2. **Desired emotional state** — The trader should feel: in control, confident the numbers are live and correct, able to act quickly. He should never feel: confused about what changed, uncertain whether data is stale, overwhelmed by information density. State which of these emotional targets the current task affects.
3. **Intuitive actions** — What would the trader instinctively try to do? Click a cell to investigate. Scan left-to-right for the biggest number. Look at color to judge direction before reading the value. Design for these instincts, not against them.
4. **Attention hierarchy** — Where does the trader look first? The desired position grid dominates visual attention. Changes (highlights, deltas) pull the eye. The updates feed is peripheral until something moves. Chat is on-demand. Identify where in this hierarchy the current task lives.
5. **Trust signals** — What tells the trader the system is working? WS connection indicator, last-tick timestamp, highlight on fresh data, absence of stale indicators. If the current task could affect trust, state how.

### 3. Scope the Design Task

Identify:
- **Which zone(s)** from `UI_SPEC.md` are affected (A–F)
- **Which flow(s)** from `docs/user-journey.md` are affected (1–4)
- **What the trader sees today** vs. **what they should see after this change**
- **What is NOT changing** — explicitly call out adjacent zones/flows that must remain untouched

### 4. Design Principles Checklist

Walk the proposed design against each principle. Cite specific decisions for each:

**Information hierarchy**
- [ ] The most important data has the most visual weight (size, contrast, position)
- [ ] Secondary information is accessible but does not compete with primary
- [ ] Nothing is shown that the trader does not need for the current flow
- [ ] Empty/loading states communicate clearly — no blank voids or spinners without context

**Cognitive load**
- [ ] The trader can understand the screen state in under 3 seconds
- [ ] No more than one decision is required at a time
- [ ] Related information is spatially grouped; unrelated information is visually separated
- [ ] Labels use trading language the persona already knows, not UI jargon or internal variable names

**Emotional response**
- [ ] Positive/neutral state feels calm and professional (dark surfaces, restrained color)
- [ ] Alerts and changes draw attention proportionally to their importance
- [ ] Sign-based coloring (indigo positive, red negative, neutral zero) is consistent
- [ ] No element creates anxiety without providing actionable information

**Trust & liveness**
- [ ] The trader can always tell whether data is live or stale
- [ ] Timestamps, connection indicators, and highlight fades reinforce freshness
- [ ] Error states are human-readable cards, never raw stack traces or cryptic codes
- [ ] If a feature is degraded or unavailable, the UI says so explicitly

**Interaction patterns**
- [ ] Click targets are obvious (cursor change, hover state, or spatial convention)
- [ ] The most common action requires the fewest clicks
- [ ] Destructive or irreversible actions require confirmation
- [ ] Keyboard shortcuts or tab order follow natural reading flow where applicable
- [ ] Context flows downstream: clicking a cell populates chat context, not the reverse

**Visual consistency**
- [ ] Colors, spacing, typography, and border radii match `UI_SPEC.md`
- [ ] New components reuse existing Tailwind utility patterns from adjacent components
- [ ] No new visual patterns are introduced without justification
- [ ] Numeric values use `tabular-nums`, sign-based coloring, and Inter font

### 5. Propose the Design

Output the design as:
- **Layout** — where it sits in the grid, sizing, relationship to adjacent zones
- **Components** — what React components are needed (new or modified), with one-line purpose each
- **Data flow** — what Context providers or services feed this component, what events it emits
- **Interactions** — what the trader can click/hover/type, and what happens when they do
- **States** — empty, loading, connected, error, and any mode-specific states
- **Rationale** — for every non-obvious choice, a one-sentence link back to a persona need, flow step, or invariant from `docs/user-journey.md`

**Do NOT write code yet. Pause and wait for explicit approval.**

### 6. Self-Review

Before reporting the design as ready:
- [ ] Every element traces back to a persona need or flow step (no speculative features)
- [ ] No invariant from `docs/user-journey.md` §Invariants is violated
- [ ] The design works in the empty/mock state (`POSIT_MODE=mock`) as well as production
- [ ] WS disconnect mid-interaction is handled gracefully
- [ ] The design does not require changes to `server/core/` (Manual Brain rule)
- [ ] The design is achievable with the current stack (React, Tailwind, react-grid-layout, Context providers)

### 7. Handoff

Once the design is approved:
- If implementation is requested, delegate to `/implement` with the approved design as the plan input
- If a spec is needed first, delegate to `/spec` to formalize acceptance criteria
- Update `docs/user-journey.md` if the design changes or adds a flow step
- Update `client/ui/UI_SPEC.md` if zone layout, component specs, or visual patterns changed
