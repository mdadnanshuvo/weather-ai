# Isobar

A small weather dashboard built on the WeatherAI API. Lightweight on purpose —
one Express route file, one HTML page, no build step — but with a few
deliberate engineering choices baked in around the parts of the brief that
mentioned scale.

## Run it

```bash
npm install
cp .env.example .env   # then paste your WeatherAI key into .env
npm start
```

Open `http://localhost:3000`.

## What it does

- Detects your location (browser geolocation, falling back to IP lookup via
  `/v1/weather-geo` if that's denied), or search any city by name.
- Shows current conditions, the Gemini AI summary, a 24-hour tape, and a
  7-day log, with a metric/imperial toggle.
- Shows your live `/v1/usage` quota in the footer.
- Has an explicit "signal lost" state for API failures, not just a blank
  screen — mapped to the docs' error codes (401/403/429/500/503).

## Design decisions worth calling out

**The API key never reaches the browser.** The frontend only ever talks to
this app's own `/api/*` routes; `server.js` is the only thing holding the
WeatherAI key and attaching the `Authorization` header. A client-side
`fetch()` straight to `api.weather-ai.co` would leak the key to anyone who
opens devtools.

**A small in-memory cache sits in front of the upstream API.** The Free plan
is capped at 1,000 requests/month, and a single user re-loading the page a
few times (or two people looking up the same city) shouldn't cost multiple
requests. Responses are cached for 10 minutes, keyed by rounded
lat/lon + units + days. It's explicitly called out in the code as a
single-instance solution — running more than one server process would need
that cache moved to something shared like Redis, since each instance would
otherwise track quota independently.

**Retries are scoped to genuinely transient failures.** 500/503 get a couple
of retries with backoff, per the docs' own guidance. 401/403/429 don't — those
are "fix the request or wait," not "try again immediately."

**The response shape is handled defensively.** The docs don't publish an
exact JSON schema for `/v1/weather` (unlike `/v1/trees/analyze`, which has a
full example). Rather than hard-code field names and risk a blank UI the
moment the real shape differs even slightly, `app.js` has a small `pick()`
helper that tries a handful of plausible key paths per field
(`current.temp`, `temp`, `temperature`, …) and renders whatever's present.
The "view raw response" panel in the footer exists so the actual shape can
be inspected and the mapping tightened once real traffic confirms it.

**City search doesn't spend WeatherAI quota.** It uses Open-Meteo's free
geocoding API (no key required) purely to turn a typed city name into
coordinates, before handing those coordinates to our own `/api/weather`.

## What I'd add next, given more time

- A shared cache (Redis) if this ran on more than one instance.
- A webhook-backed "alerts" panel using `POST /v1/webhooks`, since the Pro
  tier already supports it.
- Persisting the last-viewed city in `localStorage` so a refresh doesn't
  reset to the detected location — left out here to keep the file count
  small.

## File layout

```
server.js         Express app: /api/weather, /api/geo, /api/usage
public/index.html Markup
public/style.css  Design tokens + layout
public/app.js     Location resolution, rendering, API-shape normalization
.env.example      Copy to .env with your own key
```
