# Posit — The Narrative

## The problem

Every trading desk that holds positions overnight is running the same invisible process: a senior trader synthesises dozens of data feeds, opinions, and instincts into a single decision — how much to be long or short, and in what. This process lives entirely in one person's head. It is unwritten, unreviewable, non-transferable, and it stops the moment that person leaves the room.

The consequences compound quietly. Opinions that aren't voiced are never acted on. Opinions that are voiced are forgotten within days. When multiple people on a desk hold overlapping but distinct views, there is no honest way to reconcile them — the loudest or most recent voice wins by default. Sizing is done by gut, not by confidence-weighted math. And when the senior trader leaves the firm, everything they knew about how to run the book walks out the door with them.

This is not a technology problem. It is a language problem. Trading desks have no common language for expressing, storing, and combining positional views.

## The solution

Posit is that language.

Every view a trader holds — "realised vol is underpriced," "ETH will spike around Pectra," "funding rates are signalling a squeeze" — is declared as a configured signal with explicit parameters: magnitude, confidence, time horizon, decay shape, and how it composes with every other signal on the desk. The engine evaluates all declared signals continuously against a single equation:

**Desired Position = Edge x Bankroll / Variance**

Edge is fair value minus market-implied — how much the desk collectively thinks the market is mispricing something. Variance is the uncertainty of that estimate, weighted by the confidence assigned to each contributing signal. Bankroll is capital allocated.

The output is a desired position for every symbol and expiry, updating every tick, explainable in plain language by the LLM layer: "Your desired BTC Dec position moved from +12 to +18 because the realised vol stream drove edge up while variance stayed flat."

Nothing is forgotten. Nothing is silently reversed. Every opinion is stored, sized, and acted on consistently. The reasoning is visible to anyone who walks up to the screen.

## What Posit is, precisely

Posit is a rulebook — the written set of rules a desk uses to run its positions.

A rulebook is more than a database (it doesn't just store, it evaluates). It is more than an engine (it doesn't just compute, it encodes the desk's beliefs). It is more than a spec (it isn't a description of the system, it *is* the system). Every trader's view, every data source, every confidence weight, every decay curve — declared, composed, and executed 24/7 without the human present.

Like a company's operating manual or a sport's rule book, it is the artifact that makes the institution's knowledge independent of any single person.

## The new world

Today, positional trading expertise is trapped inside individual heads — accumulated over years, applied inconsistently, lost when people leave, and invisible to everyone else on the desk.

Posit creates a world where that expertise is written down. Where a junior trader can open the rulebook, see every signal the desk is running, understand why the book is positioned the way it is, and contribute their own view into the same framework. Where the 3am position adjustment follows the same logic as the 3pm one. Where an opinion from last Tuesday carries exactly the weight it was assigned, not the weight of how recently it was mentioned in conversation.

A world where knowledge and expertise is no longer gatekept behind the minds of individual traders, but disseminated to everyone around them — compounding, not decaying.

Trading can be formalised. Posit is the proof.
