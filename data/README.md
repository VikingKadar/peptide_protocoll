# The Amida database

Everything clinical lives here. The model picks and explains; it never invents a number.
A product with `verified: false` can be shown in the library but **never recommended**.

Run `npm run validate` after every edit. It fails on contradictions and lists what is missing.

## Filling in a product

Use `bpc157-10` in `peptides.json` as the shape to copy. It is scaffolded from the scraped
data and is **not verified** — treat it as a template, not as facts.

| Field | What it needs |
| --- | --- |
| `vialMg` | Peptide per vial. Drives every dose calculation. |
| `priceUsd` | Price per vial in USD. |
| `components` | Blends only: each peptide and its mg. Must sum to `vialMg`. |
| `tags` | Safety tags. `glpClass` and `growthPromoting` decide who gets blocked (brief §6.5). Set `tagsVerified: true` once checked. |
| `protocols[].phases` | `name`, `weeks`, `doseMcg`, `frequency`. Frequencies: `daily`, `eod`, `weekly`, `2x_week`, `3x_week`, `5on2off`. |
| `reconstitutedStableDays` | Days the mixed vial stays good. Without it the vial count assumes it never expires. |
| `contraindications`, `sideEffects`, `interactions` | `stopAndSeekCare` is what tells someone to seek care. |
| `reportedOutcomes` | Each needs a `sourceId` that exists in `sources`. Hedged wording, no promises. |
| `evidenceGrade` | A = human RCT · B = human observational · C = animal or in vitro · D = anecdotal. |
| `verified` | Set to `true` last. The validator refuses if anything is still missing. |

## compatibility.json

One row per pair, in either order:

```json
{ "a": "bpc157-10", "b": "tb500-10", "status": "synergy", "note": "Complementary repair mechanisms.", "sourceId": "s4" }
```

`synergy` · `ok` · `caution` · `avoid`. **A pair you leave out means "no data"**, and the planner
schedules those two one after another instead of together. That is the safe default, so an
unreviewed pair never becomes a combination recommendation.

## Why the numbers are not in here

Doses per injection, units on the syringe, vial counts, cost and the calendar are all computed
by `calc.js` and `combine.js` from the fields above. Example, straight from this database:

> BPC-157 10 mg, 500 mcg daily for 6 weeks → 42 injections, 3 vials, 3 ml BAC water, 15 units per dose.

Change `doseMcg` and every one of those numbers moves with it.
