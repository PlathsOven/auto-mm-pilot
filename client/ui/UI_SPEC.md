# UI Frontend Specification: Posit — a positional trading platform

## 1. Visual Identity & Brand Philosophy
* **Persona:** Intellectual research interface. Clarity, transparency, and flow around ideas — not a conventional dark trading terminal.
* **Design Metaphor:** Glass. The framework is the product; the UI lets you see through to the ideas underneath. Nothing hidden, nothing opaque.
* **Color Palette (Light Glassmorphism):**
    * **Background:** Warm light gray (`#f4f4f7`) with a subtle gradient (`#eaeaef` → `#f4f4f7` → `#f0f0f5`) to give glass something to refract.
    * **Surface/Glass Panels:** Semi-transparent white (`rgba(255,255,255,0.55)`) with `backdrop-blur-xl` (24px), `border-white/45` inner edge, `ring-1 ring-black/[0.06]` outer definition. `rounded-lg` panels, `rounded-md` cards/inputs.
    * **Solid surfaces (inputs, dropdowns):** Pure white (`#ffffff`).
    * **Accents:** Deep indigo (`#4f5bd5`) for data highlights, interactive elements, positive values.
    * **Text:** Near-black with blue undertone (`#1a1a2e`), secondary `#6e6e82`, tertiary/subtle `#a0a0b2`.
    * **Alerts:** Muted amber (`#c48a12`) for warnings; Rose-red (`#d4405c`) for errors and negative values.
* **Surfaces:** No box shadows on panels — glass catches light, not shadow. Floating overlays (popovers, drawers) use `bg-white/85 backdrop-blur-2xl ring-1 ring-black/[0.06] shadow-lg shadow-black/[0.06]`.
* **Glass utility classes:** `.glass-panel` (panels), `.glass-bar` (top bar), `.glass-card` (cards within panels).
* **Typography:**
    * **All text** uses clean sans-serif (`Inter`). `tabular-nums` for numeric alignment.
    * **Panel titles:** `text-[13px] font-medium tracking-tight text-mm-text` — sentence case, not uppercase. Dark text on glass.
    * **Section headers:** `text-[11px] font-semibold text-mm-text-dim`.
    * **Data values:** `text-[12px] font-medium tabular-nums` — numbers are the hero, slightly larger and bolder.
    * **Secondary/timestamps:** `text-[10px] text-mm-text-subtle` — recedes unless searched for.
* **Sign-based coloring:** Positive = deep indigo (`#4f5bd5`), negative = rose-red (`#d4405c`), zero = subtle neutral (`#a0a0b2`). Cell backgrounds tinted at 6% opacity.

## 2. Layout Structure
The UI is a fixed-height, single-page application (SPA) divided into four primary zones using CSS Grid.

### A. Data Streams Sidebar (Left — 2/12 Width)
* **Header:** "Data Streams" — sentence case, `zone-header` class.
* **Component:** Minimal list of live streams. Each row shows only stream name + last-update age (`formatAge`). No status pips, no registry state, no key-col metadata — those details live in Anatomy. Link: "Manage in Anatomy →".
* **Cards:** `.glass-card` treatment — `bg-white/40 backdrop-blur-lg border-white/50 rounded-md`.
* **Narrower than before** (was 3 cols, now 2) — it's a status list, not a workspace.

### B. Global Context Bar (Top — 56px Height)
* **Treatment:** `.glass-bar` — `bg-white/65 backdrop-blur-2xl border-b border-black/[0.08]`. Content slides under this frosted strip.
* **Left:** Static logo "Posit" in `mm-accent` + connection status as a colored dot only (green/amber/red), tooltip on hover for details. No `[CONNECTED]` text.
* **Centre:** Mode switcher (Eyes / Brain / Anatomy) + search (`⌘K`) + chat toggle (`⌘\`).
* **Right:** Posit Control toggle + UTC clock.

### C. Desired Positions (Centre — 7/12 Width, Full Height)
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
* **Cell coloring:** Cell **background** is tinted by sign at 6% opacity (indigo for positive, rose for negative), with text colored by sign. Cells use `text-[12px] font-medium tabular-nums`.
* **Highlighting:** Cells updated in the latest tick receive a fading left-border accent in `mm-accent` (~2s fade-out).
* **Clickable cells:** Clicking any cell pushes its context (asset, expiry, edge, UF, desired position) to the LLM Chat (Zone E) for investigation.
* **Cell notes:** Right-clicking any cell opens a popover showing per-cell notes/comments from team members. Users can read existing notes and post new ones. Cells with notes show a small count badge.
* **Data behavior:** Position values are derived from edge and uncertainty factor. Each position has a low probability (~15%) of updating on any given tick, reducing noise.

### D. Updates Feed (Right — 3/12 Width, Full Height)
* **Header:** "Updates" with a subtle **Last Update** elapsed-time indicator on the right.
* **Component:** A vertical scrollable feed of position-change cards, newest at top.
* **Card contents:**
    * Asset + Expiry label and timestamp
    * Old value → new value with signed delta, all in **$vega** units (all numbers colored by sign)
    * **Stream attribution** — top contributing streams and their edge, shown inline on the card
* **Card treatment:** `.glass-card` — `bg-white/40 backdrop-blur-lg border-white/50 rounded-md`. Stream attribution on a second line in `text-mm-text-subtle`.
* **Highlighting:** New cards receive a fading left-border accent (~2.5s) on arrival.
* **Clickable cards:** Clicking any card pushes its context (asset, expiry, old/new position, delta) to the LLM Chat (Zone E) for investigation.

### E. Posit Chat (Right-side Drawer — 420px Width)
* **Trigger:** `⌘\` keyboard shortcut or Chat button in context bar.
* **Treatment:** Glass drawer — `bg-white/70 backdrop-blur-2xl border-l border-black/[0.06] shadow-xl shadow-black/[0.06]`.
* **Component:** A scrollable message feed with a text input at the bottom.
* **Message types:**
    * **System** — auto-generated when a cell or card is clicked, summarizing the investigation context (blue left-border accent).
    * **User** — typed by the current logged-in operator, shown with initials badge and "(you)" suffix.
    * **Team** — messages from other desk members, shown with initials badge and "• team" label.
    * **Assistant (@Posit)** — responses from the LLM backend, shown with "AI" badge and blue accent border. Only triggered when the user tags `@Posit` in their message.
* **Routing:** Messages containing `@Posit` are routed to the LLM engine for investigation responses. All other messages operate as a standard team chat.
* **Interaction flow:** Click a cell/card → system context message → type `@Posit why did this change?` → LLM responds with investigation.py-style reasoning.
* **Empty state:** "Chat with your team or tag @Posit to investigate positions."

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
2. TailwindCSS for styling with custom `mm-*` color tokens.
3. Focus-driven Workbench (`pages/WorkbenchPage.tsx`) inside the `AppShell` chrome — no draggable panel grid. Surfaces use `.glass-panel`.
4. `rounded-lg` panels, `rounded-md` controls. Subtle gradient background. No box shadows on panels — glass surfaces with `backdrop-blur` and `ring-1 ring-black/[0.06]` for edge definition.
5. ChatProvider context for shared investigation state across components.

## 5. Motion Language

* **Engine:** `framer-motion`. All overlay and route transitions go through `<AnimatePresence>`; ad-hoc CSS transitions remain only for low-cost hover states and the sidebar width tween.
* **Enter/exit presets** — pick one per surface, never invent a new one:
    * **Modal** (CommandPalette, HotkeyCheatsheet, OnboardingFlow): `opacity + scale 0.98→1 + y 4→0`, 220ms, ease `[0.22, 1, 0.36, 1]`. Backdrop fades in 180ms.
    * **Drawer-right** (BlockDrawer, NotificationsCenter): `x: 100% → 0`, 280–300ms, same easing. Backdrop 200ms fade.
    * **Drawer-bottom** (ChatDock): `height: 0 → effectiveHeight`, 260ms, same easing.
    * **Popover** (small overlays): `opacity + scale 0.96→1 + y -4→0`, 180ms, ease-out.
* **Page transitions** — mode cross-fade keyed on `mode` in `App.tsx`: 220ms opacity + subtle y drift (±4px). Auth boundary (LoginPage ↔ AppShell): 240–280ms fade.
* **Splash:** `<PositSplash/>` is the brand moment — shown at app boot (pre-hydration HTML in `index.html`) and after login until `useAppReady()` returns `ready=true` (first WS tick + min 400ms display). The mark breathes at 2.6s infinite.
* **Data-trust signals are NOT motion-layer chrome.** The cell `fade-highlight` (2s row emphasis), updates-feed card entry, and `anatomy-flow-pulse` are existing keyframes tuned to reinforce freshness — do not repurpose them or throttle them as part of a motion sweep.
* **Reduced motion:** a `@media (prefers-reduced-motion: reduce)` rule in `index.css` collapses every transition and animation to 0.01ms. Framer-motion honors the same preference via its built-in reducer. Trader accessibility takes priority over polish.
* **Button press:** interactive `motion.button` elements can opt into `whileTap={{ scale: 0.97 }}` — reserved for primary nav + primary form actions, not every hover target.