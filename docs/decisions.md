# Decisions

Append-only log. When making a significant architectural or process choice, add a new entry. Never rewrite an old entry — add a new one that supersedes it and reference the predecessor.

Format per entry: **Date — Decision**. Then `Context:`, `Decision:`, `Rationale:`, `Consequences:`.

---

## 2025 — Physical client/server split for IP protection

**Context:** APT is a vendor product. The client (trading desk) gets the terminal + adapters; we retain the proprietary pricing math.

**Decision:** All proprietary computation (target-space conversion, fair value synthesis, variance estimation, desired position) lives on a remote Python server in `server/core/`. The local Electron client only handles data ingestion, format standardization, and display.

**Rationale:** If the math ran client-side, the client could decompile the Electron bundle and extract it. A physical process boundary is the only durable protection.

**Consequences:** Adds WebSocket transport complexity. Adds latency (every tick round-trips the network). Requires CORS + auth setup for the client WS endpoint. Worth it.

---

## 2025 — Polars over Pandas

**Context:** The pricing pipeline processes time series and per-block computations with heavy per-row operations.

**Decision:** Polars for all DataFrame work. Pandas is banned from the codebase.

**Rationale:** Polars' columnar expressions are materially faster (Rust backend, lazy evaluation, SIMD), and its API forces you to think in columnar ops instead of scalar loops. Pandas' `iterrows` pattern has historically been a source of O(n²) bugs in fintech Python.

**Consequences:** Slightly steeper learning curve for contributors coming from Pandas. Every pipeline change must be expressible as a Polars expression — no fallback to imperative loops.

---

## 2025 — OpenRouter with model fallback chain over single-provider LLM

**Context:** The LLM explanation layer needs to be resilient to provider outages, rate limits, and model quality regressions.

**Decision:** All LLM calls go through OpenRouter, which proxies to any provider. `server/api/config.py` declares a fallback chain (e.g. `OPENROUTER_INVESTIGATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1`) that the client tries in order.

**Rationale:** Provider lock-in is a tail risk for a product whose credibility depends on the LLM never going dark during market hours. OpenRouter's unified interface lets us swap providers without code changes.

**Consequences:** Small latency overhead on the first request. Dependency on OpenRouter's availability — if OpenRouter is down, all LLM features are down.

---

## 2025 — Singleton WebSocket ticker with broadcast

**Context:** Multiple clients may connect simultaneously; each needs to see the same pipeline state in real time.

**Decision:** A single background ticker in `server/api/ws.py` runs the pipeline on a schedule and broadcasts each tick to all connected WS clients. No per-client pipeline state.

**Rationale:** Consistency — every trader sees the same numbers at the same time. Cost — one pipeline run per tick instead of N. Simplicity — broadcast is a single loop.

**Consequences:** Ticker must be restartable (`restart_ticker()` after hot reload). State lives in module-level globals, which is a deliberate concession to singleton semantics.

---

## 2025 — Auth-gated `/ws/client` endpoint

**Context:** The client-facing WS endpoint accepts inbound snapshot frames from the trading desk. Without auth, anyone could inject data.

**Decision:** `server/api/client_ws_auth.py` validates an API key header and checks the source IP against an allowlist before accepting the WebSocket upgrade.

**Rationale:** WS endpoints are often forgotten in auth audits because they don't look like HTTP routes. Making auth the first thing a connection hits closes that gap.

**Consequences:** Operators must set `CLIENT_WS_API_KEY` and `CLIENT_WS_ALLOWED_IPS` env vars before the client can connect. Local dev uses a dev key.

---

## 2025 — Vercel (client) + Railway (server) deploy split

**Context:** The physical client/server split maps naturally onto two deploy targets.

**Decision:** Client SPA deploys to Vercel (static hosting, free tier sufficient). Server deploys to Railway (persistent Python process, $5/mo Hobby tier).

**Rationale:** Vercel is optimized for static SPAs; Railway is optimized for persistent processes with WebSocket support. Using each for its strength is cheaper and simpler than running one platform for both.

**Consequences:** Two dashboards, two env-var stores, two domains. CORS configuration is required (currently `allow_origins=["*"]` — see `README.md` troubleshooting).

---

## 2025 — Manual Brain restriction: `server/core/` is HUMAN ONLY

**Context:** LLM agents are very capable at infrastructure work (FastAPI handlers, React components, WebSocket plumbing) but make subtle, hard-to-catch mistakes in dense mathematical code. A subtle sign error in variance computation would produce numbers that look plausible and silently destroy PnL.

**Decision:** No LLM is permitted to write, modify, or refactor any file under `server/core/`. All code there is hand-written by a human. When an LLM generates Python that must touch steps 4–6 of the pipeline, it writes an empty function body with the comment `# HUMAN WRITES LOGIC HERE`.

**Rationale:** The math is the product. The math is also the IP. A single bad edit in `server/core/pipeline.py` could produce numbers that are off by enough to matter but not off by enough to notice in testing. The blast radius of a mistake here is unbounded.

**Consequences:** Agents must read `server/core/` but not write to it — this creates a clean division of labor. Enforced by a PreToolUse hook in `.claude/settings.json`. Any agent attempting to write under `server/core/` is blocked with a loud error.

---

## 2026-04-09 — Migrate harness to the Agentic Coding Playbook (Claude Code primary, Windsurf secondary in exact sync)

**Context:** The existing harness was Windsurf-centric (`.windsurfrules`, `.windsurf/workflows/`, `.cascade/commands/commit-push-pr.sh`). Claude Code is now the primary tool but Windsurf is still in active use. Without a unified rules layer, the two would drift immediately.

**Decision:**
1. Adopt the Agentic Coding Playbook structure: lean `AGENTS.md` (auto-loaded instructions), `docs/architecture.md` / `conventions.md` / `decisions.md` / `user-journey.md` / `product.md` / `stack-status.md` (context), `tasks/todo.md` / `lessons.md` / `progress.md` (tracking).
2. Claude Code is primary. Windsurf is secondary but still active.
3. Every slash command exists in both `.claude/commands/*.md` (Claude Code) and `.windsurf/workflows/*.md` (Windsurf), with byte-identical bodies. A Stop hook in `.claude/settings.json` detects drift.
4. `AGENTS.md` is the single shared instructions file (both tools auto-load it). `.windsurfrules` becomes a thin pointer.
5. `.cascade/commands/commit-push-pr.sh` is retired. Both harnesses use native `git add` + `git commit`.

**Rationale:** Dual-harness is the user's stated workflow and must be supported. A single shared rules file prevents two-source-of-truth drift. Command-level drift is the remaining risk, mitigated by the Stop hook and `/doc-sync`'s sync verification step.

**Consequences:** 20-file sync burden (10 commands × 2 harnesses). Commit discipline required: whenever a slash command is edited, both files must land in the same commit. Auto-push behavior from the old `.cascade` script is dropped — agents must not push unless explicitly asked.

---

## 2026-04-09 — Root-doc consolidation: DEPLOY merged into README, STACK_STATUS moved to docs/

**Context:** The repo root had three supplementary docs (`AGENTS.md`, `DEPLOY.md`, `STACK_STATUS.md`) whose roles overlapped with the new `docs/` structure.

**Decision:**
- `AGENTS.md` stays at root. It has a fundamentally different function from `docs/architecture.md` — directive (what the agent should do) vs. descriptive (what the system is). Playbook §A1 requires an auto-loaded instructions file.
- `DEPLOY.md` is deleted. Its content is absorbed into `README.md` as a "Deployment (Production)" section. Playbook §A6 says README is the operator's guide, which includes deployment by definition.
- `STACK_STATUS.md` is moved to `docs/stack-status.md` via `git mv` (preserves history). It has a unique function (component status registry) but belongs alongside the other context docs.

**Rationale:** Three root supplementary docs → one. Reduces cognitive load on the operator. The unique functions are preserved; only the organization changes.

**Consequences:** Any external reference (e.g. bookmarks, Railway or Vercel READMEs) pointing at `DEPLOY.md` or root-level `STACK_STATUS.md` will break. The grep verification in the migration plan catches in-repo references.

---

## 2026-04-09 — Keep `types.ts` as a hand-maintained mirror of `models.py`

**Context:** Phase 2 of the broad refactor tightened the API contract by replacing `dict[str, Any]` escape hatches with typed Pydantic submodels. The question of whether to auto-generate `client/ui/src/types.ts` from Pydantic (via `pydantic2ts` or equivalent) was raised and deferred.

**Decision:** Continue hand-maintaining `types.ts`. When a Pydantic model in `server/api/models.py` changes, the authoring agent must update `types.ts` in the same commit. Enforcement is by convention and by /doc-sync review — no tooling.

**Rationale:** Codegen is ~1 day of work including the build-step plumbing. Until schema drift becomes a real pain again, the manual sync is cheap. The Phase 2 contract tightening reduces the churn rate on models.py, so drift is less likely in the near term.

**Consequences:** Agents must continue to read `models.py` before any work that crosses the API boundary. This is already a `CLAUDE.md` rule. Revisit this decision if drift surfaces >2 bugs per quarter.
