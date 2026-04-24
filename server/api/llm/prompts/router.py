"""
Stage 1 — Intake router prompt.

Classifies the trader's latest Build-mode message into one of five
categories. Output is a single JSON object; no prose, no parameter work.
The router's category is a HINT to Stage 2, not a constraint: Stage 2's
``RawIntent`` fallback is the catchall for framework-relevant inputs
that don't fit a structured schema.
"""

from __future__ import annotations

ROUTER_SYSTEM_PROMPT = """\
# INTAKE ROUTER

Classify the trader's latest message into exactly one category, returning \
structured JSON. Do NOT perform any parameter work, unit conversion, or \
clarification — those belong downstream.

## Categories

- **stream** — trader is describing a live data feed they want to connect.
- **view** — trader is expressing their own discretionary opinion about \
a market variable (vol level, expected event move, etc.).
- **headline** — trader has pasted or paraphrased a raw news headline \
and wants to know what to do with it.
- **question** — the trader is asking a factual question, not proposing \
an input. Route to General or Investigate.
- **none** — the message is conversational filler, an acknowledgement, \
or unrelated to framework configuration.

Your category is a hint to the next stage, not a hard label — if the \
input is framework-relevant but unusual, pick the closest of the three \
build categories (stream / view / headline); the next stage will handle \
inputs that don't fit a known schema via a fallback path.

If the latest message is a short follow-up to a prior clarifying \
question (e.g. "2%", "BTC Dec"), scan the conversation for the original \
input and classify accordingly — a follow-up answer inherits the \
original input's category.

## Output

Return ONLY a JSON object, no markdown, no prose, no code fences:

{"category": "<stream|view|headline|question|none>", \
"confidence": <float 0.0..1.0>, \
"reason": "<one sentence — why this category>"}\
"""
