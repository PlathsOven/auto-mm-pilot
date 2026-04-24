# Spec: RAG over prior block intents (M5)

**Status:** Draft — ready for `/implement`. Authored 2026-04-23.

**Context:** Deferred M5 from `tasks/spec-llm-orchestration.md` §13. The `block_intents` table persists every Stage-5 commit with the trader's `original_phrasing`. This spec adds dense-vector retrieval over those phrasings so Stage 2's intent extractor sees the top-K most-similar prior commits when the trader starts a new Build turn — enabling vocabulary reuse, consistency checks ("last FOMC you used 0.03 decay"), and conflict detection ("you already have a base-vol view on BTC Dec").

## Overview

On every successful commit, the server embeds `StoredBlockIntent.original_phrasing` via OpenAI's `text-embedding-3-small` and stores the vector (JSON array of floats) on the `block_intents` row. At the start of every Build converse turn, the server embeds the trader's latest user message and computes cosine similarity against every prior intent for that user; the top-K (default 5) above a threshold are serialized into a new `## SIMILAR PRIOR INTENTS` prompt section read by Stage 2 (intent extractor). If `OPENAI_API_KEY` is unset, embeddings are skipped — the system degrades to pre-M5 behaviour without error.

Storage is SQLite-resident: embeddings live as JSON columns on `block_intents`; similarity is computed in-process via numpy. Deliberately simple — at typical volumes (<1000 intents per user) brute-force cosine is sub-10ms and avoids a new dependency / external vector store. A follow-up spec can migrate to `sqlite-vec` if per-user volumes exceed a few thousand intents.

## Requirements

### User stories
- As a trader committing "FOMC will be a 2% move on BTC Dec", I want the system to recognise that last month I committed "CPI will be a 3% move on BTC Dec" so the Stage 2 extractor keeps my vocabulary conventions consistent between the two and flags if my current view contradicts the prior one.
- As a trader who's onboarded dozens of discretionary views, I want each new proposal to be informed by what I already have in the book — so the LLM doesn't ask me for magnitude_unit every single time I've answered it the same way on every prior turn.

### Acceptance criteria
- [ ] A new `embedding` column exists on `block_intents` (JSON, nullable). Existing rows stay `NULL` — no backfill required; retrieval tolerates nulls by skipping them.
- [ ] On `POST /api/blocks/commit`, after the `block_intents` row is written, an async task embeds `original_phrasing` and writes the vector back to the same row. If the embedding call fails (network, API down, key missing), the row stays committed with `embedding=NULL` — the feature degrades, never blocks.
- [ ] On `POST /api/build/converse`, before Stage 2 runs, the server embeds the conversation's latest user message and retrieves the top-K prior `block_intents` rows for this user by cosine similarity, filtered to rows above a similarity threshold (default 0.70).
- [ ] The top-K are serialized into a markdown `## SIMILAR PRIOR INTENTS` block listing each entry's `stream_name`, `created_at`, `original_phrasing`, preset name (or custom-derivation summary), and similarity score. This block is injected into the Stage 2 system prompt via a new `similar_intents_section: str` kwarg on `build_intent_prompt`.
- [ ] Empty retrieval (no prior intents, all below threshold, or embeddings disabled) yields `""` — the prompt adds no section. Non-breaking.
- [ ] When `OPENAI_API_KEY` is unset: the commit-side embedding task short-circuits with a one-time warning log; the retrieval-side embedding call returns `None` so retrieval yields `[]`.
- [ ] Every embedding API call is audited to `llm_calls` with `stage="embedding"`, using the existing `record_call` pattern (cost, latency, provider). Failures populate the `error` field.
- [ ] Two new `LlmOrchestrationConfig` knobs: `rag_top_k: int = 5` and `rag_similarity_threshold: float = 0.70`, env-var-backed via `LLM_RAG_TOP_K` / `LLM_RAG_SIMILARITY_THRESHOLD`.

### Performance
- Commit-side embedding: async via `asyncio.create_task`, off the critical path. ~50ms round-trip, $0.00002 per call at typical phrasing length.
- Retrieval-side embedding: inline before Stage 2, adds ~50ms to the Build turn. Acceptable within the 5s end-to-end budget (§16.3).
- Similarity compute: numpy cosine over N×1536 float array. For N=1000 intents this is ~2-5ms. Negligible.
- Storage: 1536 × 4 bytes = 6KB per intent. SQLite handles this comfortably; JSON-serialised it's ~10KB. At 10K intents per user, ~100MB — still fine for SQLite but a signal to migrate to `sqlite-vec`.

### Security
- Per-user scoping: every retrieval filters by `BlockIntent.user_id == current_user.id`. No cross-user leakage.
- OpenAI API key in env, never logged. The embedding call sends the trader's `original_phrasing` + latest message to OpenAI — consistent with how OpenRouter already handles chat completions. If sensitivity is higher, a future local-embedding spec can swap the provider.
- No new endpoints, no new UI, no new auth surface.

## Technical Approach

Two new modules — one for the embedding call, one for retrieval.

**`server/api/llm/embeddings.py`** — thin async client over `https://api.openai.com/v1/embeddings` using httpx. Exposes `async def embed(text: str, user_id: str, conversation_turn_id: str | None) -> list[float] | None`. Returns `None` when disabled or on error. Every call is wrapped in `record_call` with `stage="embedding"`, `mode=None`, and the model name (`text-embedding-3-small`).

**`server/api/llm/rag.py`** — retrieval. Exposes `async def retrieve_similar(user_id: str, query_text: str, top_k: int, threshold: float) -> list[SimilarIntent]`. Loads all `block_intents` rows for `user_id` where `embedding IS NOT NULL`, embeds `query_text`, computes cosine similarity via numpy, returns the top-K above threshold. `SimilarIntent` is a small dataclass (not Pydantic — server-internal only): `{stream_name, original_phrasing, preset_id, custom_reasoning, similarity_score, created_at}`.

A second helper in `rag.py`: `serialize_for_prompt(hits: list[SimilarIntent]) -> str` produces the markdown block. Empty input → empty string.

**Wiring:**
- `server/api/routers/build.py::blocks_commit` — after `save_block_intent`, fire an `asyncio.create_task` that calls `embeddings.embed(...)` and updates the row's `embedding` column via a new `update_embedding(intent_id, vector)` helper in `server/api/llm/block_intents.py`.
- `server/api/llm/build_orchestrator.py::run_build_pipeline` — before `_run_intent_extractor`, extract the latest user message from the conversation, call `rag.retrieve_similar(...)`, serialize, and pass into `_run_intent_extractor` as `similar_intents_section`.
- `server/api/llm/prompts/intent_extractor.py::build_intent_prompt` — new `similar_intents_section: str = ""` kwarg, injected after `user_context_section`.

### Data shape changes

- `server/api/llm/models.py` — add `embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)` to `BlockIntent`.
- Pydantic `StoredBlockIntent` does NOT gain an embedding field — it's a server-internal concern, not returned to the client. No TS change.

### Files to create
- `server/api/llm/embeddings.py` — async httpx client for OpenAI embeddings + `record_call` integration.
- `server/api/llm/rag.py` — retrieval + serialize-for-prompt.

### Files to modify
- `server/api/llm/models.py` — `embedding` column on `BlockIntent`.
- `server/api/llm/block_intents.py` — `update_embedding(intent_id, vector)` helper; `get_for_rag(user_id)` helper returning `(id, original_phrasing, preset_id, custom_reasoning, embedding, created_at)` tuples for every row with an embedding.
- `server/api/llm/orchestration_config.py` — add `rag_top_k`, `rag_similarity_threshold`, plus an `embeddings_model: str = "text-embedding-3-small"` knob env-backed via `LLM_EMBEDDINGS_MODEL`.
- `server/api/config.py` — add `OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")`. Separate from `OPENROUTER_API_KEY` because OpenRouter doesn't offer embeddings.
- `server/api/llm/prompts/intent_extractor.py` — inject `similar_intents_section`.
- `server/api/llm/build_orchestrator.py` — retrieve before Stage 2, thread the section through.
- `server/api/routers/build.py::blocks_commit` — fire embedding task after the intent row persists.

## Test Cases
- **Happy path, end-to-end:** User commits 3 intents → all 3 rows have embeddings → user starts a 4th Build turn with a phrasing similar to intent #2 → `retrieve_similar` returns intent #2 at top of hits (similarity > threshold) → Stage 2 prompt contains the similar-intents section.
- **No prior intents:** fresh user → retrieval returns `[]` → prompt section is empty string → Stage 2 runs identically to pre-M5.
- **All below threshold:** user's prior intents are semantically unrelated to the new turn → retrieval returns `[]` even though rows exist.
- **Embeddings disabled (no API key):** `OPENAI_API_KEY=""` → commit-side task short-circuits with a log → row has `embedding=NULL` → retrieval on a later turn yields `[]` → system continues uninterrupted.
- **Commit-side embedding failure:** OpenAI 500 → the `asyncio.create_task` logs the error → the intent row stays live with `embedding=NULL`. The commit response succeeds unchanged.
- **Retrieval-side embedding failure:** OpenAI 500 at retrieval → `rag.retrieve_similar` returns `[]` and logs → Stage 2 runs without RAG.
- **Mixed rows (some with embedding, some without):** retrieval skips null-embedding rows, ranks the rest.
- **Per-user scoping:** User A's 5 intents + User B's 5 intents → retrieval for User A returns only from A's set.
- **Audit row:** every successful embedding API call writes one `llm_calls` row with `stage="embedding"`, model name, latency, and prompt/completion tokens.

## Out of Scope
- **Cross-user retrieval.** Intents stay private.
- **Hybrid retrieval (BM25 + dense).** Single dense pass only.
- **Re-ranking (cross-encoder).** Straight cosine top-K.
- **Local / sentence-transformers fallback.** Deferred to a follow-up spec if needed.
- **`sqlite-vec` migration.** Brute-force cosine is sufficient for v1.
- **Re-embedding when the embeddings model changes.** If we switch models, old vectors stay — future retrieval mixes models, which degrades quality. A migration / re-embed script is a separate spec.
- **Embedding other fields** (synthesis reasoning, intent raw interpretation). `original_phrasing` only for v1.
- **Stage 3 RAG** (injecting similar intents into the synthesiser). Stage 2 only for v1; the synthesiser is already grounded via preset-registry serialisation.
- **UI exposure of similar-intent hits.** Server-side prompt injection only; no client surface.
