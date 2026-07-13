// ISOBAR — a small weather dashboard on top of the WeatherAI API.
//
// Why a backend at all, for such a small project?
//   1. The API key must never reach the browser. Any client-side fetch()
//      call would ship the key in plain view of devtools/network tab.
//   2. WeatherAI's Free plan caps out at 1,000 requests/month. A tiny
//      in-memory cache means repeat views of the same location (or a page
//      refresh) don't burn quota, which matters a lot at this tier.
//   3. It's a natural place to normalize error codes (401/403/429/5xx)
//      into messages the UI can render without knowing about HTTP.
//
// Everything here is intentionally small — one file, no framework beyond
// Express, no database. The point is to show the pattern, not to over-build
// a take-home assignment.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = "https://api.weather-ai.co";
const API_KEY = process.env.WEATHERAI_API_KEY;

if (!API_KEY) {
  console.warn(
    "[isobar] WEATHERAI_API_KEY is not set. Copy .env.example to .env and add your key."
  );
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Tiny in-memory cache. Good enough for a single-instance demo; the comment
// below is where this would need to change for a real deployment.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — weather doesn't change fast
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}
// NOTE: at more than one server instance, this cache needs to move to
// something shared (Redis, etc.) or requests will double-hit the upstream
// API depending on which instance handles them.

// ---------------------------------------------------------------------------
// Upstream fetch helper: retries transient 5xx errors with backoff, and
// turns WeatherAI's error codes into a consistent shape for the frontend.
// ---------------------------------------------------------------------------
async function callWeatherAI(pathname, searchParams, { retries = 2 } = {}) {
  const url = new URL(pathname, API_BASE);
  for (const [k, v] of Object.entries(searchParams)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
    } catch (networkErr) {
      if (attempt === retries) {
        const err = new Error("Could not reach WeatherAI.");
        err.status = 502;
        throw err;
      }
      await sleep(300 * 2 ** attempt);
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      return {
        data,
        rateLimit: {
          limit: res.headers.get("x-ratelimit-limit"),
          remaining: res.headers.get("x-ratelimit-remaining"),
          reset: res.headers.get("x-ratelimit-reset"),
        },
        geo: {
          country: res.headers.get("x-country"),
          region: res.headers.get("x-region"),
          city: res.headers.get("x-city"),
        },
      };
    }

    // Retry only on server-side hiccups, per the docs' guidance.
    if ((res.status === 500 || res.status === 503) && attempt < retries) {
      await sleep(300 * 2 ** attempt);
      continue;
    }

    const bodyText = await res.text().catch(() => "");
    console.error(
      `[isobar] WeatherAI ${res.status} on ${pathname} — raw body: ${bodyText.slice(0, 500)}`
    );
    const err = new Error(await friendlyError(res));
    err.status = res.status;
    err.raw = bodyText;
    throw err;
  }
}

async function friendlyError(res) {
  switch (res.status) {
    case 401:
      return "The API key was rejected. Check WEATHERAI_API_KEY on the server.";
    case 403:
      return "This endpoint isn't included in the current plan.";
    case 429:
      return "Monthly request quota reached. Try again once it resets.";
    case 400:
      return "That request was missing something the API needs.";
    case 503:
      return "WeatherAI's data source is temporarily unreachable.";
    default:
      return "WeatherAI returned an unexpected error.";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Current conditions + forecast for a coordinate.
app.get("/api/weather", async (req, res) => {
  const { lat, lon, units = "metric", days = "7", ai = "true" } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon are required." });
  }

  const cacheKey = `w:${Number(lat).toFixed(2)}:${Number(lon).toFixed(
    2
  )}:${units}:${days}:${ai}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await callWeatherAI("/v1/weather", { lat, lon, units, days, ai });
    cacheSet(cacheKey, result);
    res.json({ ...result, cached: false });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, raw: err.raw });
  }
});

// IP-based geo fallback, used when the browser denies geolocation.
app.get("/api/geo", async (req, res) => {
  try {
    const result = await callWeatherAI("/v1/weather-geo", {
      ip: "auto",
      ai: "false",
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Quota readout for the instrument-panel footer.
app.get("/api/usage", async (req, res) => {
  try {
    const result = await callWeatherAI("/v1/usage", {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[isobar] listening on http://localhost:${PORT}`);
});
