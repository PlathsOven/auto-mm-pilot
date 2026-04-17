# Spec: Multi-user auth + per-user scoping

## Overview

Posit is currently a single shared instance: one bankroll, one stream list, one pipeline, one WebSocket broadcast. We're flipping it to a multi-user product where every trader signs up with username + password, gets their own isolated view, and sees a personal API key on an Account page that they copy into their SDK integration. Mock-scenario data is removed entirely — the Deribit pricer is the real end-to-end data path going forward.

This spec covers: signup/login, session handling, per-user scoping of every mutable server-side registry, the Account page, an Admin page with usage analytics, and the removal of the mock path.

## Requirements

### User stories

- As a **new trader**, I want to sign up with username + password so I can start using Posit without contacting the operator.
- As a **returning trader**, I want to log in at app launch and land in the state I left off (my streams, blocks, bankroll still configured).
- As a **trader integrating an SDK**, I want to copy a stable API key from an Account page inside the UI so I can paste it into my own system.
- As a **trader whose key may have leaked**, I want to regenerate my API key from the Account page so the old one stops working immediately.
- As the **operator (admin)**, I want a page listing every user, their signup date, last-login, and a usage breakdown (manual block creations, clicks, time on app) so I can understand adoption.

### Acceptance criteria

- [ ] Landing URL shows a Login page when unauthenticated; already-authenticated sessions go straight to the dashboard.
- [ ] Login page has a "Create account" link that reveals a Signup form (username + password, password confirmed twice).
- [ ] Signup is fully open — no invite code, no verification in v1.
- [ ] Usernames are case-insensitive, 3–32 chars, `[a-zA-Z0-9_-]` only, stored normalized to lowercase; display preserves the casing the user chose at signup.
- [ ] Successful login / signup drops the user into an **empty** Posit dashboard (no streams, no blocks, bankroll = 0).
- [ ] Every `/api/*` request from the UI is authenticated by a session token; every `/api/*` request from the SDK is authenticated by the user's API key. Both resolve to the same `user_id` server-side.
- [ ] Every mutable server-side registry (streams, blocks, bankroll, market values, snapshot buffer, pipeline/engine state) is keyed by `user_id`. User A mutating their bankroll does not affect User B.
- [ ] `/ws` pipeline broadcast is per-user: User A only receives ticks for User A's pipeline.
- [ ] `/ws/client` is already auth-gated via API key; now the inbound snapshots and outbound positions route into the owning user's pipeline only.
- [ ] Top-right menu has a "Log out" option (clears session, returns to Login page) and an "Account" option.
- [ ] Account page shows: username, signup date, API key (plain text, copy button, "Regenerate key" button with confirm-modal).
- [ ] Admin users see an additional "Admin" link in the top-right menu leading to an Admin page.
- [ ] Admin page lists every user with: username, signup date, last-login, active WS connections count, total manual blocks created, total sessions, cumulative time-on-app (sum of session durations).
- [ ] Login persistence is session-only: closing the app (or reloading the tab) requires re-login.
- [ ] All mock-scenario code paths are removed. Starting the server with no configured users means the API simply has no data to serve, not synthetic data.

### Performance

- Auth adds one DB lookup per request; budget ≤ 5ms p95 on a cached lookup (in-memory LRU of `api_key → user_id` and `session_token → user_id`).
- Target scale: ≤ 10 concurrent users. SQLite on a persistent volume is the planned store.
- WS broadcast fan-out: each tick now goes to one user's connections, not all. Memory per user: ~same as today's single-instance footprint.

### Security

- Passwords stored as bcrypt hashes with per-password salt. Never logged, never returned in any response.
- Session tokens: opaque random 32-byte tokens, stored in a `sessions` table with `expires_at`, returned to client in login response body. Client holds them in memory only (no localStorage, no cookies) — matches the "re-login on every launch" requirement and avoids a class of XSS credential theft.
- API keys: opaque random 32-byte URL-safe tokens, one per user. Shown in plain text only on the Account page. Regenerate immediately invalidates the old key.
- `/api/*` auth resolution order: `Authorization: Bearer <session_token>` → `x-api-key` header → `?api_key=` query. First match wins. Missing or invalid → 401.
- Admin role is a boolean column on the `users` table. Non-admin users accessing `/api/admin/*` → 403.
- No password reset flow in v1 (deferred per product scope). If a user forgets their password, the operator handles it manually via DB.
- Usage analytics never record full request bodies (PII risk). Only event type + low-cardinality metadata.

## Technical Approach

Introduce a `User` entity and a persistence layer. Every existing singleton registry becomes a dict keyed by `user_id`, and every request/WS path first resolves the caller's `user_id` before touching state. Auth happens in FastAPI middleware (REST) and in the WS accept handshake. The client gains a `LoginPage`, a `SignupPage`, an `AccountPage`, an `AdminPage`, and an `AuthProvider` that holds the session token + user profile in memory.

**Storage:** SQLite via SQLAlchemy (sync, wrapped in `asyncio.to_thread` for FastAPI), on a Railway persistent volume. Tables: `users`, `sessions`, `api_keys` (1:1 with users but separated so rotation is a row-replace), `usage_events`. A migration script seeds the schema on first boot.

**Per-user scoping:** Today, `engine_state.py`, `stream_registry.py`, `market_value_store.py`, and `snapshot_buffer.py` each expose module-level singletons. We wrap each in a `UserRegistry[T]` generic that lazily creates a new instance the first time a given `user_id` accesses it. All callers thread `user_id` through. The `server/core/` pipeline code is **unchanged** — it always received configs as arguments and is already stateless relative to any singleton; the per-user `StreamConfig` list is what changes.

**WS fan-out:** `ws.py`'s broadcast set becomes a `dict[user_id, set[WebSocket]]`. The singleton ticker now iterates `(user_id, connections)` pairs, runs the pipeline once per active user (only those with ≥1 connection **and** ≥1 configured stream), and sends the result to that user's sockets.

**Usage analytics:** A tiny `POST /api/events` endpoint accepts `{ type, metadata }` and writes a row to `usage_events`. Client instruments: panel opens/closes, block drawer submit (`manual_block_create`), Zone C cell click, app focus/blur for time-on-app. Server-side, `manual_block_create` can also be written automatically in the block router so client-side counts cross-check. Admin page aggregates these with SQL.

**Mock removal:** Delete `init_mock()` call from `main.py` lifespan, delete `engine_state.init_mock()` body, remove `POSIT_MODE` branching, drop `server/api/llm/context_db.py` MOCK initialization. `server/core/mock_scenario.py` deletion is a Manual Brain task — see that section below.

### Data shape changes

**`server/api/models.py` — additions:**

```python
class UserPublic(BaseModel):
    id: str
    username: str  # display form (original casing)
    created_at: datetime
    is_admin: bool

class SignupRequest(BaseModel):
    username: str  # 3–32 chars, [a-zA-Z0-9_-] — validated in router
    password: str  # min 8 chars — validated in router

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    session_token: str
    user: UserPublic

class ApiKeyResponse(BaseModel):
    api_key: str  # only returned on /api/account/key GET and regenerate

class UsageEventRequest(BaseModel):
    type: Literal["panel_open", "panel_close", "manual_block_create",
                  "cell_click", "app_focus", "app_blur"]
    metadata: dict[str, str | int | float | bool] = {}

class AdminUserSummary(BaseModel):
    id: str
    username: str
    created_at: datetime
    last_login_at: datetime | None
    active_ws_connections: int
    manual_block_count: int
    total_sessions: int
    total_time_seconds: int
```

**`client/ui/src/types.ts` — mirror the above.** Pydantic remains upstream.

### Files to create

**Server:**
- `server/api/db.py` — SQLAlchemy engine, session factory, `get_db()` dependency, bootstrap DDL.
- `server/api/auth/models.py` — ORM models: `User`, `Session`, `ApiKey`, `UsageEvent`.
- `server/api/auth/passwords.py` — `hash_password`, `verify_password` (bcrypt).
- `server/api/auth/tokens.py` — `generate_session_token`, `generate_api_key`, `resolve_user_from_request(request) → User | None`.
- `server/api/auth/dependencies.py` — FastAPI `Depends` helpers: `current_user`, `current_admin`.
- `server/api/routers/auth.py` — `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`.
- `server/api/routers/account.py` — `GET /api/account` (profile), `GET /api/account/key`, `POST /api/account/key/regenerate`.
- `server/api/routers/events.py` — `POST /api/events`.
- `server/api/routers/admin.py` — `GET /api/admin/users` (admin-only).
- `server/api/user_scope.py` — `UserRegistry[T]` generic wrapper for per-user singletons.

**Client:**
- `client/ui/src/providers/AuthProvider.tsx` — session state, login/logout/signup actions, `useAuth()` hook.
- `client/ui/src/pages/LoginPage.tsx` — login form + "Create account" toggle to signup form.
- `client/ui/src/pages/AccountPage.tsx` — username, signup date, API key (masked + "Show" toggle + copy button), regenerate button.
- `client/ui/src/pages/AdminPage.tsx` — table of users with usage columns.
- `client/ui/src/services/authApi.ts` — `signup`, `login`, `logout`, `getAccount`, `getApiKey`, `regenerateApiKey`.
- `client/ui/src/services/adminApi.ts` — `listUsers`.
- `client/ui/src/services/eventsApi.ts` — `logEvent(type, metadata)` helper.
- `client/ui/src/hooks/useTimeOnApp.ts` — fires `app_focus` / `app_blur` events on `visibilitychange`.

### Files to modify

**Server:**
- `server/api/main.py` — replace `_ApiKeyMiddleware` with a unified auth resolver; register new routers; drop `init_mock()` lifespan call; drop `POSIT_MODE` branching.
- `server/api/engine_state.py` — become a `UserRegistry[EngineState]`; drop `init_mock`. Every public function gains a `user_id` param.
- `server/api/stream_registry.py` — become a `UserRegistry[StreamRegistry]`. Every public function gains `user_id`.
- `server/api/market_value_store.py` — per-user.
- `server/api/llm/snapshot_buffer.py` — per-user.
- `server/api/ws.py` — per-user broadcast map; ticker iterates users; `restart_ticker()` semantics preserved.
- `server/api/client_ws.py` + `server/api/client_ws_auth.py` — resolve `user_id` from API key; route inbound frames into that user's engine.
- `server/api/routers/streams.py`, `snapshots.py`, `bankroll.py`, `transforms.py`, `pipeline.py`, `blocks.py`, `market_values.py`, `llm.py` — every endpoint gains `current_user: User = Depends(current_user)`; every call into registries passes `user_id`.
- `server/api/models.py` — add auth/account/admin/usage models (see above).
- `server/api/config.py` — drop `POSIT_MODE` and `get_valid_api_keys()` (replaced by DB lookup); add `DATABASE_URL`, `BCRYPT_ROUNDS`, `SESSION_TTL_HOURS`.

**Client:**
- `client/ui/src/App.tsx` — gate the dashboard behind `useAuth().user`; render `<LoginPage />` otherwise. Add top-right menu with Account / Admin / Logout items.
- `client/ui/src/services/api.ts` — `apiFetch` reads `session_token` from `AuthProvider` via a module-level getter and sets `Authorization: Bearer <token>`; on 401, calls a registered `onUnauthorized` callback that logs the user out.
- `client/ui/src/providers/WebSocketProvider.tsx` — include session token on connect (`ws://.../ws?session_token=...`); reconnect on logout/login.
- `client/ui/src/types.ts` — mirror new Pydantic models.

### Files to delete

- `server/core/mock_scenario.py` — **Manual Brain** (see below).
- Any prod code that imports from `mock_scenario` — adjust those callers (which live in `server/api/`, safe to edit) to stop importing.

## Test Cases

**Happy path:**
- New user signs up → lands on empty dashboard → configures a stream → refreshes page → re-logs in → stream is still there.
- Two users logged in concurrently, each configures a different stream → each sees only their own stream in the Stream Library.
- User copies API key from Account page → uses it in SDK → SDK's `POST /api/snapshots` writes to that user's snapshot buffer only.
- User regenerates API key → old key returns 401 on next request → new key works.
- Admin logs in → Admin page shows row per user with correct signup dates and usage counts.

**Edge cases:**
- **Empty state:** new user's `/api/pipeline/dimensions` returns an empty response (no streams configured) rather than 500.
- **WS disconnect mid-feature:** UI loses WS, re-connects with session token, resumes receiving only their own ticks.
- **Session expiry:** session TTL elapses during use → next `/api/*` request gets 401 → client logs out gracefully and routes to Login page.
- **Malformed signup:** username violates charset/length rules or password < 8 chars → 422 with a user-readable message, no user row written.
- **Duplicate signup:** same username (case-insensitive) signs up twice → 409 Conflict, first user unaffected.
- **Login wrong password:** 401 with a generic "invalid username or password" message (no enumeration leak).
- **Two users hit WS simultaneously:** each ticker run is isolated; one user's slow pipeline doesn't block the other's broadcast.
- **Non-admin hits `/api/admin/users`:** 403.
- **Key rotation while SDK is connected to `/ws/client`:** the existing WS stays open (grandfathered), but next HTTP call from that SDK fails — documented, SDK users reconnect with the new key. *(Flag: confirm this is acceptable or whether rotation should also force-close live WS.)*
- **Concurrent key regeneration:** transaction-wrapped, the second request reads the fresh key.

## Out of Scope

- **Password reset / "forgot password" flow.** Deferred. Operator handles forgotten passwords via direct DB edit. Without an email on file, the operator must verify identity out-of-band before resetting.
- **Email capture / verification.** No email is collected at signup. Any future password-reset or notification feature will need a separate "add email" step.
- **Username changes.** Usernames are immutable in v1.
- **Multi-factor auth.** Deferred.
- **Multiple API keys per user / named keys.** Decided: one key per user.
- **Org / team accounts, shared desks, role-based sharing.** Out of scope. Posit v1 multi-user = each trader isolated. Desk-collaboration features (shared views, team chat across users) are a later phase.
- **Migrating existing single-instance data into a first user's account.** Throwing it away per your call.
- **Mock scenario as a dev-only toggle.** Removing entirely; Deribit pricer is the new dev path.
- **Usage-event retention / purging.** Events accumulate forever in v1; retention policy deferred until volume warrants.
- **Usage events surfaced to the user themselves.** Only admin sees them.

## Manual Brain Boundary

`server/core/mock_scenario.py` must be **deleted by a human**, not the LLM, per the Manual Brain rule. The spec requires its removal; the implementation step delegates that one file to you.

All other `server/core/` files remain untouched. The pipeline (`pipeline.py`, `transforms/`, `helpers.py`, `config.py`, `serializers.py`) is stateless relative to user identity — it receives a `list[StreamConfig]` and a `bankroll`, returns a DataFrame. Per-user scoping happens entirely in `server/api/`, which threads the per-user config list into the existing pipeline call. No Manual-Brain logic changes.

If during implementation I discover a hidden cross-user coupling inside `server/core/` (e.g., a module-level cache keyed by symbol that two users could contend on), I will stop and report it in `tasks/progress.md` rather than patch around it.

## Resolved Decisions

1. **Password hashing:** bcrypt via `passlib[bcrypt]`, 12 rounds.
2. **DB backend:** SQLite on a Railway persistent volume, accessed through SQLAlchemy.
3. **First admin bootstrap:** env var `POSIT_ADMIN_USERNAMES=<comma-separated-usernames>` set on the Railway deployment. At signup, if the chosen username (case-insensitive) matches an entry, the new row's `is_admin` flag is set to `true`.
4. **WS auth:** `ws://.../ws?session_token=<token>`; accept handler validates and closes with code 1008 on invalid/missing token.
5. **Key rotation:** regenerating the API key immediately force-closes any open `/ws/client` connections bound to the old key (WS close code 1008, reason `"key_rotated"`). SDK users must reconnect with the new key.
6. **Client-side usage events instrumented in v1:** `panel_open`, `panel_close`, `manual_block_create` (also written server-side in the block router for cross-check), `cell_click` (Zone C), `app_focus`, `app_blur`.
7. **Mock removal:** hard removal in this PR. No `--dev-scenario` escape hatch. Dev flow during the gap until Deribit lands = manually configure streams via the UI.
8. **Username rules:** case-insensitive, 3–32 chars, charset `[a-zA-Z0-9_-]`, stored lowercase, displayed with original casing.

## Open Questions

_(all resolved)_
