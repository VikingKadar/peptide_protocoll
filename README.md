# Orvexis — Peptid Protocol Engine

Webbapp som tar emot ett hälsomål i fritext och bygger ett peptidprotokoll med dosering,
faser, spädning, kalenderpåminnelser och totalkostnad. Protokollet genereras av Gemini
utifrån en lokal forskningsdatabas och Orvexis sortiment.

## Kom igång

```bash
npm install
cp .env.example .env    # fyll i din GEMINI_API_KEY
npm start
```

Öppna sedan http://localhost:3000

## Miljövariabler (.env)

| Variabel | Beskrivning |
| --- | --- |
| `GEMINI_API_KEY` | Nyckel från Google AI Studio. Krävs — servern startar inte utan den. |
| `GEMINI_MODEL` | Modell att använda. Standard: `gemini-3.5-flash`. |
| `PORT` | Port för servern. Standard: `3000`. |

`.env` är med i `.gitignore` och ska aldrig committas.
Kör `npm run models` för att lista vilka Gemini-modeller din nyckel har tillgång till.

## Forskningsdatabasen (`peptider/`)

Mappen `peptider/` innehåller den skrapade forskningsdatan (en mapp per peptid med
utdrag från WikiTides, PubMed, Examine och forum). Den ligger **inte** i git — den
innehåller andras innehåll och personuppgifter, och behöver kopieras in manuellt.

Servern läser mappen en gång vid start och bygger en kunskapsbas av de källor som
varje produkt i `PEPTIDE_CATALOG` pekar ut via sitt `sources`-fält. Saknas mappen
loggas en varning per produkt, och svaren blir betydligt sämre.

## Så fungerar det

1. Frontend (`index.html`) skickar målet till `POST /api/protocol`.
2. Servern bygger en prompt av kunskapsbasen + sortimentet och anropar Gemini.
3. Gemini väljer en produkt via `productId` och föreslår upplägg, faser och schema.
4. Servern fyller i pris och lagerstatus **från katalogen** — aldrig från AI-svaret —
   och validerar schemat innan det skickas till webbläsaren.
5. Användaren kan spara protokollet till Anteckningar (delningsmenyn på iPhone) eller
   ladda ner injektionsschemat som en `.ics`-fil med påminnelser.

## Lägga upp den live (Render)

1. Kör `npm run build:kb` lokalt och committa `knowledge-base.json`. Den ersätter
   `peptider/` på servern, eftersom datamappen inte följer med i git.
2. Skapa konto på render.com, välj **New → Web Service** och koppla detta repo.
   `render.yaml` fyller i bygg- och startkommandon automatiskt.
3. Lägg in `GEMINI_API_KEY` under **Environment** i Render. Nyckeln ska aldrig i koden.
4. Deploy. Appen svarar på adressen Render ger dig, t.ex. `orvexis-protocol-engine.onrender.com`.

Frontend anropar samma adress som den serveras från, så ingen URL behöver ändras.
Gratisplanen somnar efter en kvarts inaktivitet — första besöket efter det tar ca en minut.

### Kostnadsskydd

Varje anrop till `/api/protocol` kostar pengar hos Google. Servern släpper därför igenom
högst 8 förfrågningar per IP och minut, och `MAX_DAILY_REQUESTS` (standard 300) per dygn.

## Viktigt

Appen genererar inte medicinsk rådgivning. Innehållet bygger på forskningsdata och
användarrapporter, och produkterna säljs för forskningsändamål.
