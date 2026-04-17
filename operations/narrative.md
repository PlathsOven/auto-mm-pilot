# Posit — The Narrative

## The problem

Every trading desk that holds positions runs on opinions. "Realised vol is underpriced." "ETH will spike around Pectra." "Funding rates are signalling a squeeze." These views drive what the book looks like — how much to be long or short, and in what.

The problem is that opinions live in individual heads, expressed in natural language, with no shared notation. When three traders on a desk hold overlapping but distinct views on the same name, there is no honest way to reconcile them. One person is putting on a position another is quietly reversing. The loudest or most recent voice wins by default. Nobody — including the desk head — can see the full picture of what the team collectively believes, or whether the book actually reflects it.

The consequences compound quietly. Opinions that aren't voiced are never acted on. Opinions that are voiced are forgotten within days. Sizing is done by gut, not by confidence-weighted math. When a senior trader leaves the firm, every positional insight they held walks out the door. And across any given week, the book drifts away from what the desk actually thinks — not because anyone made a mistake, but because there was no common language in which to align.

This is not a technology problem. It is a language problem. Trading desks have no common language for expressing, combining, and acting on positional views.

## The solution

Posit is that language.

Every view a trader holds — "realised vol is underpriced," "ETH will spike around Pectra," "funding rates are signalling a squeeze" — is declared as a configured signal with explicit parameters: magnitude, confidence, time horizon, decay shape, and how it composes with every other signal on the desk. The engine evaluates all declared signals continuously against a single equation:

**Desired Position = Edge x Bankroll / Variance**

Edge is fair value minus market-implied — how much the desk collectively thinks the market is mispricing something. Variance is the uncertainty of that estimate, weighted by the confidence assigned to each contributing signal. Bankroll is capital allocated.

The output is a desired position for every symbol and expiry, updating every tick, explainable in plain language by the LLM layer: "Your desired BTC Dec position moved from +12 to +18 because the realised vol stream drove edge up while variance stayed flat."

Nothing is forgotten. Nothing is silently reversed. Every opinion is stored, sized, and acted on consistently. The reasoning is visible to anyone who walks up to the screen.

## What Posit is, precisely

Posit is the formalisation of positional trading — the common language a desk uses to express, compose, and act on every view its traders hold.

Every opinion enters Posit as a structured object with explicit parameters: magnitude, confidence, time horizon, decay shape, and how it composes with every other opinion on the desk. This is the formalisation — opinions stop being verbal, ephemeral, and private, and become declared, durable, and shared. A view expressed by one trader is visible to every other trader, weighted by declared confidence, and composed with their views according to agreed-upon rules.

The closest analogy is what double-entry bookkeeping did for commerce. Before double-entry, a firm's financial state lived in one clerk's memory. Double-entry gave merchants a shared notation — debits and credits, a grammar for composition, a balance that anyone could audit. It didn't replace the merchant's judgment. It gave the merchant's judgment a language in which it could be written down, composed, and preserved.

Posit does the same for positional trading. It doesn't replace the trader's views. It gives those views a language in which they can be declared, reconciled across a team, and acted on consistently — every tick, every symbol, even when nobody is watching.

## The new world

Today, a desk's positional views exist in fragments — scattered across individual heads, Slack threads, verbal handoffs, and the residue of yesterday's morning meeting. No single person can see all of them. No system reconciles them. The book reflects some combination of whoever spoke most recently and whoever happened to be at their screen.

Posit creates a world where the desk speaks a common language. Where every trader declares their view in the same notation — magnitude, confidence, time horizon, decay — and every view composes with every other view according to agreed-upon rules. Where a junior trader can see every signal the desk is running, understand why the book is positioned the way it is, and contribute their own view into the same framework. Where the 3am position adjustment follows the same logic as the 3pm one. Where opinions from different people on the same name don't collide silently — they compose explicitly, weighted by confidence, visible to everyone.

A world where the desk's collective conviction is formalised, not inferred. Where expertise compounds across the team instead of decaying inside individuals.

Positional trading can be formalised. Posit is the proof.
