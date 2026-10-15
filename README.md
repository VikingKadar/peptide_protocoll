# Amida — Peptide protocols, calculated

Describe a goal, get a research-based peptide protocol with exact mixing, dosing,
schedule and cost. The model picks and explains; every number is computed in code.

## Getting started

```bash
npm install
cp .env.example .env    # add your GEMINI_API_KEY
npm start
```

Then open http://localhost:3000

```bash
npm test        # calc, combine and safety unit tests
npm run validate # checks the peptide database
```

## Environment (.env)

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Key from Google AI Studio. Required — the server refuses to start without it. |
| `GEMINI_MODEL` | Model to use. Default: `gemini-3.5-flash`. |
| `MAX_DAILY_REQUESTS` | Daily cap on protocol requests. Default: 300. |
| `PORT` | Server port. Default: 3000. |

`.env` is gitignored and must never be committed.

## How it fits together

| File | Role |
| --- | --- |
| `index.html` | The whole frontend: one page, inline CSS and JS. |
| `server.js` | API, rate limiting, the Gemini call and response validation. |
| `calc.js` | Single-protocol math: concentration, units, schedule, vials, cost. |
| `combine.js` | Multi-goal math: compatibility, timeline placement, merged schedule. |
| `safety.js` | Safety gates, applied to the catalog before the model sees it. |
| `data/` | The peptide database and compatibility table. See `data/README.md`. |
| `validate-db.js` | Refuses incomplete or contradictory database entries. |
| `catalog.js`, `knowledge-base.js` | The older catalog and research extracts, still used by the live flow. |

Doses, units, vial counts, cost and calendars are never produced by the model.
It chooses a product and writes the words; the files above compute the numbers.

## The research database (`peptider/`)

Holds the scraped research data, one folder per peptide. It is **not** in git — it
contains other people's content and personal data, so copy it in manually.

The server reads it at startup. Without it, run `npm run build:kb` on a machine that
has it and commit `knowledge-base.json`, which ships in its place.

## Deploying (Render)

1. Run `npm run build:kb` locally and commit `knowledge-base.json`.
2. On render.com: **New → Web Service**, connect this repo. `render.yaml` fills in the rest.
3. Add `GEMINI_API_KEY` under **Environment**.
4. Deploy. The free plan sleeps after 15 minutes idle; the first visit after that takes about a minute.

## Important

Amida provides educational information based on published research. It is not medical
advice. Products are sold for research use. Talk to a licensed clinician before starting
any compound.
