# UI Frontend Specification: APT — Automated Positional Trader

## 1. Visual Identity & Brand Philosophy
* **Persona:** Clean, professional trading terminal. Precise, minimalist, and authoritative.
* **Color Palette:**
    * **Background:** Deep Charcoal (`#0D1117`) or Slate Black (`#0B0E14`).
    * **Surface/Cards:** Darker Slate (`#161B22`) with subtle 1px borders (`#30363D`).
    * **Accents:** Cyber Blue (`#58A6FF`) for data highlights; Neutral White (`#C9D1D9`) for text.
    * **Alerts:** Amber (`#D29922`) for warnings; Muted Red (`#F85149`) for errors. Avoid bright "Retail Green."
* **Typography:**
    * **All text** (including numbers, timestamps, and data values) uses clean sans-serif (`Inter`). No monospaced fonts anywhere. Use `tabular-nums` for numeric alignment.
    * Use proper casing for headers and labels (e.g., "Desired Positions", not `DESIRED_POS`).
* **Sign-based coloring:** All numeric values are colored by sign — positive = Cyber Blue, negative = Muted Red, zero = dim neutral.

## 2. Layout Structure
The UI is a fixed-height, single-page application (SPA) divided into four primary zones using CSS Grid.

### A. Data Streams Sidebar (Left — 15% Width)
* **Header:** "Data Streams"
* **Component:** A list of active adapters (e.g., `KDB_CLIENT_PROD`, `SQL_LOCAL_BTC`).
* **Per-stream display:** Status pip (colored dot) + status label + last update time (e.g., "3s ago"). No waveforms or heartbeat animations.

### B. Global Context Bar (Top — 60px Height)
* **Left:** Static logo and app name — **APT** (Automated Positional Trader) with connection status badge. No engine state display (OPTIMIZING/STABILIZING removed).
* **Center:** Operating Space as a **dropdown menu** (e.g., "D50 VOLATILITY"), even if only one option exists.
* **Right:** UTC clock with millisecond precision.
* **Last Update** has been moved to the Updates section (Zone D).

### C. Desired Positions (Center Top — 55% Width, 55% Height)
* **Header:** "Desired Positions" with a dropdown toggle between nine view modes and a unit label.
* **Assets:** BTC and ETH only.
* **Layout:** Pivoted table — rows are **coins** (BTC, ETH), columns are **expiries** (27MAR26, 25APR26, etc.), values are the selected metric.
* **View modes** (dropdown):
    1. **Desired Position ($vega)** — current engine output per cell, in $vega units
    2. **Current Position ($vega)** — current actual fill level per cell
    3. **Desired Difference ($vega)** — desired − current, showing execution gap
    4. **Change ($vega)** — delta from a baseline, with time-based reference timeframe selector
    5. **Market Implied Vol (vp)** — current market-implied volatility per cell
    6. **Fair Implied Vol (vp)** — engine's fair implied volatility per cell
    7. **Edge (Fair − Market) (vp)** — vol points edge = fair − market implied
    8. **Edge (signal) (vp)** — annualised vol points, the raw edge signal per cell
    9. **Uncertainty Factor** — unitless uncertainty/variance factor per cell
* **Formula:** `desiredPos = (edge / uncertaintyFactor) × bankroll`. Bankroll is configured on the backend only, not displayed in the UI.
* **Timeframe selector** (visible in Change mode): Latest / 1 min / 5 min / 15 min.
* **Cell coloring:** Cell **background** is tinted by sign (blue for positive, red for negative), with text also colored by sign.
* **Highlighting:** Cells updated in the latest tick receive a fading blue highlight (~2s fade-out).
* **Clickable cells:** Clicking any cell pushes its context (asset, expiry, edge, UF, desired position) to the LLM Chat (Zone E) for investigation.
* **Cell notes:** Right-clicking any cell opens a popover showing per-cell notes/comments from team members. Users can read existing notes and post new ones. Cells with notes show a small count badge.
* **Data behavior:** Position values are derived from edge and uncertainty factor. Each position has a low probability (~15%) of updating on any given tick, reducing noise.

### D. Updates Feed (Right Top — 30% Width, 40% Height)
* **Header:** "Updates" with a subtle **Last Update** elapsed-time indicator on the right.
* **Component:** A vertical scrollable feed of position-change cards, newest at top.
* **Card contents:**
    * Asset + Expiry label and timestamp
    * Old value → new value with signed delta, all in **$vega** units (all numbers colored by sign)
    * **Concise justification** — a one-line reason for the position change in small text
* **Highlighting:** New cards receive a fading blue highlight (~2.5s) on arrival.
* **Clickable cards:** Clicking any card pushes its context (asset, expiry, old/new position, delta, reason) to the LLM Chat (Zone E) for investigation.

### E. Team Chat (Right Bottom — 30% Width, 60% Height)
* **Header:** "Team Chat" with hint "Tag @APT to query the engine" and a "Clear context" button when investigation context is active.
* **Component:** A scrollable message feed with a text input at the bottom. Combined team + LLM chat.
* **Message types:**
    * **System** — auto-generated when a cell or card is clicked, summarizing the investigation context (blue left-border accent).
    * **User** — typed by the current logged-in operator, shown with initials badge and "(you)" suffix.
    * **Team** — messages from other desk members, shown with initials badge and "• team" label.
    * **Assistant (@APT)** — responses from the LLM backend, shown with "AI" badge and blue accent border. Only triggered when the user tags `@APT` in their message.
* **Routing:** Messages containing `@APT` are routed to the LLM engine for investigation responses. All other messages operate as a standard team chat.
* **Interaction flow:** Click a cell/card → system context message → type `@APT why did this change?` → LLM responds with investigation.py-style reasoning.
* **Empty state:** "Chat with your team or tag @APT to investigate positions."

### F. Daily Trading Wrap (Center Bottom — 55% Width, 45% Height)
* **Header:** "Daily Trading Wrap" with generation timestamp.
* **Layout:** Two-column layout within the zone.
* **Left column:**
    * **Largest Position Changes** — top position deltas with driver explanations using investigation.py market-native language.
    * **Largest Desired Position Changes** — top desired position deltas with driver explanations.
    * **Current Risks** — amber-accented risk items with specific exposure details.
* **Right column:**
    * **Best Case Scenarios** — blue-accented scenarios with trigger conditions describing data feed changes that would move fairs in favorable direction.
    * **Worst Case Scenarios** — red-accented scenarios with trigger conditions.
* **Data:** Generated once per session from engine state snapshot. All language follows investigation.py §5 Linguistic Guardrails.

## 3. Technical Constraints
* **Architecture:** The UI listens to a WebSocket at `localhost:8000` (or configured server IP).
* **Data Handling:** Central React Context state manager. Only rows/cards that changed re-render.
* **Separation of Logic:** All math is server-side. The UI merely renders the JSON payload received from the engine.
* **Obfuscation:** No logic traces or raw calculation parameters in the UI.

## 4. Build Instructions
1. Electron + React (Vite) + TypeScript boilerplate.
2. TailwindCSS for styling.
3. CSS Grid layout for the five zones.
4. Mock WebSocket provider for immediate testing before the server is live.
5. Sharp edges (no rounded corners), no gradients, high contrast.
6. ChatProvider context for shared investigation state across components.