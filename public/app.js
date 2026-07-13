// ISOBAR frontend.
//
// One deliberate design note: the WeatherAI docs don't publish an exact
// response schema for /v1/weather (unlike /v1/trees/analyze, which does).
// Rather than hard-code a guess and break the moment the real shape
// differs, `pick()` below tries a short list of plausible key paths for
// each value and renders whatever it finds — and the "view raw response"
// panel at the bottom exists specifically so this can be verified and
// tightened once real data is flowing.

const els = {
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchResults: document.getElementById("searchResults"),
  locateBtn: document.getElementById("locateBtn"),
  placeName: document.getElementById("placeName"),
  placeTime: document.getElementById("placeTime"),
  asOf: document.getElementById("asOf"),
  temp: document.getElementById("temp"),
  condition: document.getElementById("condition"),
  range: document.getElementById("range"),
  aiSummary: document.getElementById("aiSummary"),
  chips: document.getElementById("chips"),
  hourlyPanel: document.getElementById("hourlyPanel"),
  hourlyTape: document.getElementById("hourlyTape"),
  dailyPanel: document.getElementById("dailyPanel"),
  dailyLog: document.getElementById("dailyLog"),
  fault: document.getElementById("fault"),
  faultMsg: document.getElementById("faultMsg"),
  retryBtn: document.getElementById("retryBtn"),
  unitToggle: document.getElementById("unitToggle"),
  quotaFill: document.getElementById("quotaFill"),
  quotaNum: document.getElementById("quotaNum"),
  rawToggle: document.getElementById("rawToggle"),
  rawPanel: document.getElementById("rawPanel"),
};

let state = {
  lat: null,
  lon: null,
  placeLabel: null,
  units: "metric",
  lastPayload: null,
};

init();

async function init() {
  els.unitToggle.addEventListener("click", onUnitToggle);
  els.locateBtn.addEventListener("click", () => resolveLocation(true));
  els.searchForm.addEventListener("submit", (e) => e.preventDefault());
  els.searchInput.addEventListener("input", debounce(onSearchInput, 300));
  els.retryBtn.addEventListener("click", () => loadWeather());
  els.rawToggle.addEventListener("click", toggleRaw);
  document.addEventListener("click", (e) => {
    if (!els.searchForm.contains(e.target)) hideResults();
  });

  fetchUsage();
  await resolveLocation(false);
}

/* ---------------------------------------------------------------------
 * Location resolution: browser geolocation first, IP-based fallback
 * second. Both feed the same loadWeather(lat, lon) path.
 * ------------------------------------------------------------------- */

async function resolveLocation(userInitiated) {
  if (!("geolocation" in navigator)) return resolveByIp();

  els.locateBtn.classList.add("spinning");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.locateBtn.classList.remove("spinning");
      state.placeLabel = null; // let reverse info come from AI summary / headers if present
      loadWeather(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      els.locateBtn.classList.remove("spinning");
      if (userInitiated) {
        showFault("Location access was denied. Search a city instead, or check your browser's site permissions.");
      } else {
        resolveByIp();
      }
    },
    { timeout: 8000 }
  );
}

async function resolveByIp() {
  try {
    const res = await fetch("/api/geo");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not detect location.");
    const geo = data.geo || {};
    if (geo.city) state.placeLabel = `${geo.city}, ${geo.country || ""}`.trim();
    const lat = pick(data.data, ["lat", "location.lat", "current.lat"]) ?? -1.2921;
    const lon = pick(data.data, ["lon", "location.lon", "current.lon"]) ?? 36.8219;
    loadWeather(lat, lon);
  } catch (err) {
    // Last resort default so the panel is never empty on first load.
    loadWeather(-1.2921, 36.8219, "Nairobi, KE");
  }
}

/* ---------------------------------------------------------------------
 * City search via Open-Meteo's free geocoding endpoint (no key needed).
 * This is a separate, unrelated service from WeatherAI — used purely to
 * turn "Kampala" into coordinates before calling our own /api/weather.
 * ------------------------------------------------------------------- */

async function onSearchInput() {
  const q = els.searchInput.value.trim();
  if (q.length < 2) return hideResults();

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en`
    );
    const data = await res.json();
    renderResults(data.results || []);
  } catch {
    hideResults();
  }
}

function renderResults(results) {
  if (!results.length) return hideResults();
  els.searchResults.innerHTML = "";
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "search-result";
    const region = [r.admin1, r.country].filter(Boolean).join(", ");
    row.innerHTML = `<span class="r-name">${escapeHtml(r.name)}</span><span class="r-meta">${escapeHtml(region)}</span>`;
    row.addEventListener("click", () => {
      hideResults();
      els.searchInput.value = r.name;
      loadWeather(r.latitude, r.longitude, `${r.name}, ${r.country_code || r.country || ""}`);
    });
    els.searchResults.appendChild(row);
  }
  els.searchResults.hidden = false;
}

function hideResults() {
  els.searchResults.hidden = true;
}

/* ---------------------------------------------------------------------
 * Weather loading + rendering
 * ------------------------------------------------------------------- */

async function loadWeather(lat, lon, label) {
  state.lat = lat;
  state.lon = lon;
  if (label) state.placeLabel = label;

  showSkeleton();
  hideFault();

  try {
    const url = `/api/weather?lat=${lat}&lon=${lon}&units=${state.units}&days=7&ai=true`;
    const res = await fetch(url);
    const payload = await res.json();
    if (!res.ok) {
      const e = new Error(payload.error || "Something went wrong.");
      e.raw = payload.raw;
      throw e;
    }

    state.lastPayload = payload;
    render(payload);
    fetchUsage();
  } catch (err) {
    showFault(err.message || "Could not load weather data.");
    if (err.raw) els.rawPanel.textContent = err.raw;
  }
}

function render(payload) {
  const d = payload.data || {};
  els.rawPanel.textContent = JSON.stringify(payload, null, 2);

  const place =
    state.placeLabel ||
    pick(d, ["location.name", "location.city", "city", "location.label"]) ||
    formatCoords(state.lat, state.lon);
  els.placeName.textContent = place;

  const tz = pick(d, ["location.timezone", "timezone"]);
  updateClock(tz);

  const unitSymbol = state.units === "imperial" ? "°F" : "°C";
  const temp = pick(d, ["current.temp", "current.temperature", "temp", "temperature"]);
  els.temp.textContent = temp !== undefined ? Math.round(temp) : "–";

  const condition = pick(d, [
    "current.condition", "current.summary", "current.description",
    "current.weather.description", "condition", "summary",
  ]) || "Conditions unavailable";
  els.condition.textContent = condition;

  const hi = pick(d, ["daily.0.temp_max", "daily.0.high", "current.temp_max", "today.high"]);
  const lo = pick(d, ["daily.0.temp_min", "daily.0.low", "current.temp_min", "today.low"]);
  els.range.textContent =
    hi !== undefined && lo !== undefined
      ? `H ${Math.round(hi)}° · L ${Math.round(lo)}°`
      : "";

  const summary = pick(d, ["ai_summary", "summary_ai", "ai.summary", "insight", "insights.summary"]);
  els.aiSummary.textContent = summary || "";

  renderChips(d, unitSymbol);
  renderHourly(pick(d, ["hourly", "hours"]) || []);
  renderDaily(pick(d, ["daily", "days"]) || []);

  els.asOf.textContent = `read ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  clearSkeleton();
}

function renderChips(d, unitSymbol) {
  const feelsLike = pick(d, ["current.feels_like", "current.feelslike", "feels_like"]);
  const humidity = pick(d, ["current.humidity", "humidity"]);
  const wind = pick(d, ["current.wind_speed", "current.wind", "wind_speed"]);
  const pressure = pick(d, ["current.pressure", "pressure"]);
  const uv = pick(d, ["current.uv_index", "uv_index", "current.uv"]);

  const items = [
    feelsLike !== undefined && icon("feels", `Feels ${Math.round(feelsLike)}${unitSymbol}`),
    humidity !== undefined && icon("humidity", `${Math.round(humidity)}% humidity`),
    wind !== undefined && icon("wind", `${Math.round(wind)} ${state.units === "imperial" ? "mph" : "km/h"}`),
    pressure !== undefined && icon("pressure", `${Math.round(pressure)} hPa`),
    uv !== undefined && icon("uv", `UV ${Math.round(uv)}`),
  ].filter(Boolean);

  els.chips.innerHTML = items.join("");
}

function renderHourly(hours) {
  if (!Array.isArray(hours) || !hours.length) {
    els.hourlyPanel.hidden = true;
    return;
  }
  els.hourlyPanel.hidden = false;
  els.hourlyTape.innerHTML = "";
  hours.slice(0, 24).forEach((h, i) => {
    const time = pick(h, ["time", "hour", "dt"]);
    const temp = pick(h, ["temp", "temperature"]);
    const cond = pick(h, ["condition", "summary", "weather.description"]) || "";
    const el = document.createElement("div");
    el.className = "hour" + (i === 0 ? " now" : "");
    el.innerHTML = `
      <span class="h-time mono">${i === 0 ? "now" : formatHour(time)}</span>
      ${weatherIcon(cond, "h-icon")}
      <span class="h-temp">${temp !== undefined ? Math.round(temp) + "°" : "–"}</span>
    `;
    els.hourlyTape.appendChild(el);
  });
}

function renderDaily(days) {
  if (!Array.isArray(days) || !days.length) {
    els.dailyPanel.hidden = true;
    return;
  }
  els.dailyPanel.hidden = false;
  els.dailyLog.innerHTML = "";

  const allTemps = days.flatMap((day) => [
    pick(day, ["temp_min", "low"]),
    pick(day, ["temp_max", "high"]),
  ]).filter((v) => typeof v === "number");
  const gMin = allTemps.length ? Math.min(...allTemps) : 0;
  const gMax = allTemps.length ? Math.max(...allTemps) : 1;
  const span = Math.max(gMax - gMin, 1);

  days.forEach((day, i) => {
    const date = pick(day, ["date", "day", "dt"]);
    const cond = pick(day, ["condition", "summary", "weather.description"]) || "";
    const hi = pick(day, ["temp_max", "high"]);
    const lo = pick(day, ["temp_min", "low"]);
    const precip = pick(day, ["precipitation_probability", "pop", "precip_chance"]);

    const left = typeof lo === "number" ? ((lo - gMin) / span) * 100 : 0;
    const width = typeof hi === "number" && typeof lo === "number" ? ((hi - lo) / span) * 100 : 30;

    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `
      <span class="d-name mono">${i === 0 ? "Today" : formatDay(date)}</span>
      ${weatherIcon(cond, "d-icon")}
      <span class="d-scale"><span class="d-scale-fill" style="left:${left}%;width:${width}%"></span></span>
      <span class="d-range">
        <span class="lo">${lo !== undefined ? Math.round(lo) + "°" : "–"}</span>
        <span class="hi">${hi !== undefined ? Math.round(hi) + "°" : "–"}</span>
      </span>
      ${precip !== undefined ? `<span class="d-precip mono">${Math.round(precip)}%</span>` : ""}
    `;
    els.dailyLog.appendChild(el);
  });
}

/* ---------------------------------------------------------------------
 * Usage / quota
 * ------------------------------------------------------------------- */

async function fetchUsage() {
  try {
    const res = await fetch("/api/usage");
    const payload = await res.json();
    if (!res.ok) return;
    const d = payload.data || {};
    const used = pick(d, ["requests_used", "used", "requestsUsed"]);
    const limit = pick(d, ["requests_limit", "limit", "requestsLimit"]);
    if (typeof used === "number" && typeof limit === "number" && limit > 0) {
      const pct = Math.min(100, (used / limit) * 100);
      els.quotaFill.style.width = pct + "%";
      els.quotaNum.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()} req`;
      if (pct > 90) els.quotaFill.style.background = "var(--danger)";
    } else {
      els.quotaNum.textContent = "usage unavailable";
    }
  } catch {
    els.quotaNum.textContent = "usage unavailable";
  }
}

/* ---------------------------------------------------------------------
 * UI helpers
 * ------------------------------------------------------------------- */

function onUnitToggle() {
  state.units = state.units === "metric" ? "imperial" : "metric";
  document.querySelectorAll(".unit-toggle .u").forEach((u) => {
    u.classList.toggle("active", u.dataset.u === state.units);
  });
  if (state.lat !== null) loadWeather(state.lat, state.lon);
}

function toggleRaw() {
  els.rawPanel.hidden = !els.rawPanel.hidden;
  els.rawToggle.textContent = els.rawPanel.hidden ? "view raw response" : "hide raw response";
}

function showFault(message) {
  els.faultMsg.textContent = message;
  els.fault.hidden = false;
}
function hideFault() {
  els.fault.hidden = true;
}

function showSkeleton() {
  [els.temp, els.condition, els.placeName].forEach((el) => el.classList.add("skel"));
}
function clearSkeleton() {
  [els.temp, els.condition, els.placeName].forEach((el) => el.classList.remove("skel"));
}

function updateClock(tz) {
  const tick = () => {
    try {
      els.placeTime.textContent = new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz || undefined,
      }).format(new Date());
    } catch {
      els.placeTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  };
  tick();
  clearInterval(window.__clockTimer);
  window.__clockTimer = setInterval(tick, 30000);
}

function formatCoords(lat, lon) {
  if (lat === null) return "—";
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

function formatHour(t) {
  if (!t) return "--";
  const d = new Date(t);
  if (isNaN(d)) return String(t).slice(0, 5);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

function formatDay(t) {
  if (!t) return "--";
  const d = new Date(t);
  if (isNaN(d)) return String(t).slice(5, 10);
  return d.toLocaleDateString([], { weekday: "short" }).toUpperCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* Reads a dotted/indexed path off an object, trying each candidate path
 * in order and returning the first defined value. e.g.
 * pick(obj, ["current.temp", "temp"]) */
function pick(obj, paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    let ok = true;
    for (const p of parts) {
      if (cur == null || !(p in cur)) { ok = false; break; }
      cur = cur[p];
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/* ---------------------------------------------------------------------
 * Tiny inline icon set — a handful of line icons covering both the
 * "chip" stats and weather conditions, keyword-matched so we don't
 * depend on WeatherAI shipping a specific icon code.
 * ------------------------------------------------------------------- */

const ICONS = {
  feels: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M12 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  humidity: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z" stroke="currentColor" stroke-width="1.6"/></svg>`,
  wind: `<svg viewBox="0 0 24 24" fill="none"><path d="M3 8h11a2.5 2.5 0 1 0-2.4-3.2M3 16h14a2.5 2.5 0 1 1-2.4 3.2M3 12h9a2 2 0 1 0-1.9-2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  pressure: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  uv: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

function icon(key, label) {
  return `<span class="chip">${ICONS[key] || ""}<span class="cv">${escapeHtml(String(label))}</span></span>`;
}

const WEATHER_ICONS = {
  clear: `<circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  cloud: `<path d="M6.5 18a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1.7A4.5 4.5 0 0 1 17.5 18h-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  rain: `<path d="M6.5 14a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1.7A4.5 4.5 0 0 1 17.5 14h-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 17.5 7 20M12 17.5l-1 2.5M16 17.5l-1 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  storm: `<path d="M6.5 13a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1.7A4.5 4.5 0 0 1 17.5 13h-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 13l-3 5h3l-2 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  snow: `<path d="M6.5 13a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1.7A4.5 4.5 0 0 1 17.5 13h-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 17v4M12 17v4M16 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 3"/>`,
  fog: `<path d="M4 10h16M3 14h18M5 18h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  wind: ICONS.wind.match(/<path[^>]*>/)[0],
};

function weatherIcon(condition, cls) {
  const c = String(condition).toLowerCase();
  let key = "cloud";
  if (/thunder|storm|lightning/.test(c)) key = "storm";
  else if (/snow|sleet|ice/.test(c)) key = "snow";
  else if (/rain|drizzle|shower/.test(c)) key = "rain";
  else if (/fog|mist|haze/.test(c)) key = "fog";
  else if (/wind/.test(c)) key = "wind";
  else if (/clear|sun/.test(c)) key = "clear";
  else if (/cloud|overcast/.test(c)) key = "cloud";
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none">${WEATHER_ICONS[key]}</svg>`;
}
