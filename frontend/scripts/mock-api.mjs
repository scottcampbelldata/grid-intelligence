// Zero-dependency mock of the Grid Intelligence /v1 API.
// Dev-only: lets the frontend run the full "happy path" without the Python
// platform, so UI states and visuals can be exercised and screenshotted.
//
//   node scripts/mock-api.mjs            # serves on :8787
//   PORT=9000 node scripts/mock-api.mjs  # custom port
//
// Data is synthetic but shaped/scaled like the real sources (daily load curves,
// plausible fuel mix, a confidence band on the forecast, a few anomalies).

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const DELAY = Number(process.env.DELAY ?? 0); // ms artificial latency (demo loading states)
const HOUR = 3600_000;

// Anchor every series to the top of the current hour so the charts line up.
const nowHour = Math.floor(Date.now() / HOUR) * HOUR;
const iso = (ms) => new Date(ms).toISOString();

// Deterministic pseudo-noise so reloads look stable.
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
// A smooth daily load curve in [0,1], peaking late afternoon.
function diurnal(hourMs) {
  const h = new Date(hourMs).getUTCHours();
  const t = ((h - 17 + 24) % 24) / 24; // 0 at the ~17:00 peak
  return 0.62 + 0.38 * Math.cos(2 * Math.PI * t);
}

const BAS = [
  ["PJM", 92_000],
  ["MISO", 74_000],
  ["ERCO", 58_000],
  ["SWPP", 31_000],
  ["CISO", 28_000],
  ["SOCO", 27_000],
  ["NYIS", 18_000],
  ["ISNE", 14_000],
  ["FPL", 23_000],
  ["TVA", 21_000],
];

function demandLatest(hours) {
  const rows = [];
  for (let i = hours; i >= 0; i--) {
    const t = nowHour - i * HOUR;
    const lag = i <= 1 ? 0.45 : 1; // simulate trailing reporting lag (gets trimmed)
    for (const [ba, base] of BAS) {
      const r = rng(ba.charCodeAt(0) * 7 + i);
      const v = base * diurnal(t) * (0.97 + 0.06 * r()) * lag;
      // Trailing-incomplete hours: drop some BAs so the trim logic engages.
      if (i <= 1 && r() < 0.5) continue;
      rows.push({ period_utc: iso(t), ba_code: ba, value_mwh: Math.round(v) });
    }
  }
  return rows;
}

function demandHeadline() {
  const sum = (off) =>
    BAS.reduce((s, [, base]) => s + base * diurnal(nowHour - off * HOUR), 0);
  const now = sum(2); // last complete hour
  const ago = sum(26) * 0.971; // a touch lower yesterday → ~+3% day over day
  return {
    as_of_utc: iso(nowHour - 2 * HOUR),
    total_mwh_now: Math.round(now),
    total_mwh_24h_ago: Math.round(ago),
    bas: BAS.length,
    delta_pct: ((now - ago) / ago) * 100,
  };
}

const FUELS = [
  ["NG", "Natural gas", false, false, 0.38],
  ["NUC", "Nuclear", false, true, 0.19],
  ["WND", "Wind", true, true, 0.12],
  ["COL", "Coal", false, false, 0.09],
  ["SUN", "Solar", true, true, 0.08],
  ["WAT", "Hydro", true, true, 0.06],
  ["BAT", null, false, true, 0.025],
  ["GEO", "Geothermal", true, true, 0.02],
  ["OTH", "Other", false, false, 0.035],
];
const TOTAL_GEN = 460_000;

function generationShare() {
  return FUELS.map(([code, name, ren, cf, share]) => ({
    fuel_code: code,
    fuel_name: name,
    is_renewable: ren,
    is_carbon_free: cf,
    mwh: Math.round(TOTAL_GEN * share),
    pct: share * 100,
  }));
}
function generationMix(hours) {
  const rows = [];
  for (let i = hours; i >= 0; i--) {
    const t = nowHour - i * HOUR;
    const lag = i <= 1 ? 0.4 : 1;
    for (const [code, , , , share] of FUELS) {
      const r = rng(code.charCodeAt(0) * 13 + i);
      // Solar tracks daylight; others track load loosely.
      const shape = code === "SUN" ? Math.max(0, Math.cos((2 * Math.PI * ((new Date(t).getUTCHours() - 13) / 24)))) : diurnal(t);
      const v = TOTAL_GEN * share * (0.4 + 0.6 * shape) * (0.96 + 0.08 * r()) * lag;
      if (i <= 1 && r() < 0.5) continue;
      rows.push({ period_utc: iso(t), fuel_code: code, value_mwh: Math.round(v) });
    }
  }
  return rows;
}

function anomalies() {
  const sev = ["high", "moderate", "low", "critical", "moderate", "low"];
  const which = ["ERCO", "CISO", "PJM", "MISO", "FPL", "NYIS"];
  return which.map((ba, k) => {
    const expected = (BAS.find((b) => b[0] === ba)?.[1] ?? 20000) * diurnal(nowHour - (k + 3) * HOUR);
    const resid = expected * (0.08 + 0.04 * k) * (k % 2 ? -1 : 1);
    return {
      period_utc: iso(nowHour - (k + 3) * HOUR),
      ba_code: ba,
      actual_mwh: Math.round(expected + resid),
      expected_mwh: Math.round(expected),
      residual_mwh: Math.round(resid),
      z_score: Number((resid / (expected * 0.03)).toFixed(2)),
      severity: sev[k],
    };
  });
}

function interchange(hours) {
  const pairs = [["PJM", "MISO"], ["MISO", "SWPP"], ["ERCO", "SWPP"], ["CISO", "SWPP"], ["NYIS", "ISNE"], ["PJM", "NYIS"], ["SOCO", "FPL"], ["TVA", "MISO"]];
  return pairs.map(([from, to], k) => ({
    from_ba: from,
    to_ba: to,
    net_mwh: Math.round((k % 2 ? -1 : 1) * (1200 + 900 * Math.sin(k))),
    n_obs: hours,
  }));
}

function forecast(ba) {
  const base = BAS.find((b) => b[0] === ba)?.[1] ?? 30_000;
  const actual = [];
  for (let i = 72; i >= 1; i--) {
    const t = nowHour - i * HOUR;
    const r = rng(ba.charCodeAt(0) + i);
    actual.push({ period_utc: iso(t), value_mwh: Math.round(base * diurnal(t) * (0.97 + 0.06 * r())) });
  }
  const fc = [];
  for (let i = 0; i < 48; i++) {
    const t = nowHour + i * HOUR;
    const yhat = base * diurnal(t);
    const spread = yhat * (0.03 + 0.0025 * i); // widening band
    fc.push({
      period_utc: iso(t),
      yhat_mwh: Math.round(yhat),
      yhat_lower: Math.round(yhat - spread),
      yhat_upper: Math.round(yhat + spread),
      model_name: "SARIMAX(2,0,1)(1,1,0,24)",
    });
  }
  return { ba_code: ba, actual, forecast: fc };
}

function accuracy(hours, baCode) {
  const perBa = (mult) =>
    BAS.slice(0, 8).map(([ba], k) => ({
      ba_code: ba,
      pairs: 160 + k,
      mape_pct: Number((mult * (2.1 + 0.4 * k)).toFixed(2)),
      rmse_mwh: Math.round(mult * (base(ba) * 0.03)),
    }));
  const base = (ba) => BAS.find((b) => b[0] === ba)?.[1] ?? 30000;
  return {
    window: { hours },
    ba_code: baCode ?? null,
    metric_notes: "MAPE and RMSE over out-of-sample hourly pairs, last " + hours + "h.",
    sources: [
      { source: "sarimax", pairs: 1280, mape_pct: 2.74, rmse_mwh: 1180, per_ba: perBa(1) },
      { source: "eia_day_ahead", pairs: 1280, mape_pct: 3.41, rmse_mwh: 1520, per_ba: perBa(1.25) },
    ],
  };
}

const BA_COORDS = {
  PJM: [39.95, -75.16], MISO: [44.98, -93.27], ERCO: [30.27, -97.74], SWPP: [35.47, -97.52],
  CISO: [38.58, -121.49], SOCO: [33.75, -84.39], NYIS: [42.65, -73.75], ISNE: [42.36, -71.06],
  FPL: [27.99, -82.45], TVA: [36.16, -86.78],
};
function weather() {
  const cond = ["Clear", "Partly cloudy", "Cloudy", "Light rain", "Sunny", "Overcast"];
  return BAS.map(([ba], k) => ({
    station_id: `BA:${ba}`,
    period_utc: iso(nowHour),
    temperature_c: Number((14 + 12 * Math.sin(k) ).toFixed(1)),
    wind_speed_kph: Number((8 + 14 * Math.abs(Math.cos(k))).toFixed(1)),
    cloud_cover_pct: Math.round(20 + 60 * Math.abs(Math.sin(k * 1.3))),
    short_forecast: cond[k % cond.length],
    latitude: BA_COORDS[ba]?.[0] ?? null,
    longitude: BA_COORDS[ba]?.[1] ?? null,
  }));
}

const EU_ZONES = [
  ["10YDE-VE-------2", "Germany (50Hertz)", 62_000, 52.5, 13.4],
  ["10YFR-RTE------C", "France", 54_000, 48.85, 2.35],
  ["10YGB----------A", "Great Britain", 33_000, 51.5, -0.12],
  ["10YES-REE------0", "Spain", 29_000, 40.42, -3.7],
  ["10YIT-GRTN-----B", "Italy (North)", 31_000, 45.46, 9.19],
  ["10YNL----------L", "Netherlands", 13_000, 52.37, 4.9],
  ["10YBE----------2", "Belgium", 10_000, 50.85, 4.35],
  ["10YPL-AREA-----S", "Poland", 21_000, 52.23, 21.0],
];
function europeLoad(hours) {
  const rows = [];
  for (let i = hours; i >= 0; i--) {
    const t = nowHour - i * HOUR;
    const lag = i <= 1 ? 0.4 : 1;
    for (const [eic, , base] of EU_ZONES) {
      const r = rng(eic.charCodeAt(3) + i);
      if (i <= 1 && r() < 0.5) continue;
      rows.push({ period_utc: iso(t), bidding_zone: eic, value_mw: Math.round(base * diurnal(t) * (0.96 + 0.07 * r()) * lag) });
    }
  }
  return rows;
}
function europeWeather() {
  const cond = ["Clear", "Partly cloudy", "Cloudy", "Light rain", "Overcast"];
  return EU_ZONES.map(([eic, name, , lat, lon], k) => ({
    station_id: `EU:${eic}`,
    period_utc: iso(nowHour),
    temperature_c: Number((9 + 9 * Math.sin(k)).toFixed(1)),
    wind_speed_kph: Number((10 + 16 * Math.abs(Math.cos(k))).toFixed(1)),
    cloud_cover_pct: Math.round(30 + 55 * Math.abs(Math.sin(k))),
    short_forecast: cond[k % cond.length],
    zone_name: name,
    latitude: lat,
    longitude: lon,
  }));
}

function freshness() {
  const src = [
    ["eia_demand", 1900, 6200, 12500, null],
    ["eia_generation", 2100, 6400, 9800, null],
    ["entsoe_load", 2600, 7100, 7400, null],
    ["noaa_weather", 3400, 5400, 480, null],
    ["eia_interchange", 104000, 104000, 0, "stale: source publish lag"],
  ];
  return src.map(([source, sf, sp, rows, err]) => ({
    source,
    last_period_utc: iso(nowHour - Math.round(sp / 3600) * HOUR),
    last_fetch_utc: iso(nowHour - Math.round(sf / 3600) * HOUR + (HOUR - (Date.now() % HOUR))),
    last_rows: rows,
    last_error: err,
    sec_since_fetch: sf,
    sec_since_period: sp,
  }));
}
function ingestRuns(limit) {
  const out = [];
  const src = ["eia_demand", "eia_generation", "entsoe_load", "noaa_weather"];
  for (let i = 0; i < limit; i++) {
    const s = src[i % src.length];
    const start = nowHour - i * HOUR;
    const ok = !(i === 3);
    out.push({
      source: s,
      started_at: iso(start),
      finished_at: iso(start + 42_000),
      rows_written: ok ? 1200 - i * 7 : 0,
      status: ok ? "success" : "error",
      error_message: ok ? null : "HTTP 429 from upstream; backing off",
    });
  }
  return out;
}
function validation() {
  const checks = [
    ["energy_balance", "pass", "1.8%", "≤ 5%", "%", "Generation vs demand recon within tolerance."],
    ["fuel_shares", "pass", "100.0%", "= 100%", "%", "Fuel shares sum to total generation."],
    ["demand_continuity", "warn", "2 gaps", "0 gaps", "", "Two hourly gaps in ERCO demand in the last 24h."],
    ["forecast_coverage", "pass", "10/10", "= 10", "BAs", "All balancing authorities have a current forecast."],
    ["anomaly_rate", "warn", "6", "≤ 5", "events", "Slightly elevated anomaly count in the last 24h."],
    ["freshness", "fail", "29.0h", "≤ 6h", "", "Interchange feed is stale due to upstream publish lag."],
  ];
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c[1]]++;
  return {
    as_of_utc: iso(nowHour),
    summary,
    checks: checks.map(([name, status, value, threshold, unit, explanation]) => ({
      name, status, value, threshold, unit, explanation,
      counts: status === "pass" ? { pass: 10 } : { pass: 8, [status]: 2 },
      details: [],
    })),
  };
}

function route(url) {
  const u = new URL(url, "http://x");
  const p = u.pathname;
  const hours = Number(u.searchParams.get("hours") ?? 24);
  if (p === "/v1/demand/headline") return demandHeadline();
  if (p === "/v1/demand/latest") return demandLatest(hours);
  if (p === "/v1/generation/share") return generationShare();
  if (p === "/v1/generation/mix") return generationMix(hours);
  if (p === "/v1/anomalies/recent") return anomalies();
  if (p === "/v1/interchange/flows") return interchange(hours);
  if (p === "/v1/balancing-authorities") return BAS.map(([ba]) => ({ ba_code: ba }));
  if (p.startsWith("/v1/forecast/accuracy")) return accuracy(hours, u.searchParams.get("ba_code") ?? undefined);
  if (p.startsWith("/v1/forecast/")) return forecast(decodeURIComponent(p.split("/").pop()));
  if (p === "/v1/weather/latest") return weather();
  if (p === "/v1/europe/load") return europeLoad(hours);
  if (p === "/v1/europe/weather") return europeWeather();
  if (p === "/v1/freshness") return freshness();
  if (p === "/v1/ingest-runs") return ingestRuns(Number(u.searchParams.get("limit") ?? 20));
  if (p === "/v1/validation") return validation();
  return null;
}

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  let body;
  try {
    body = route(req.url ?? "/");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
    return;
  }
  if (body === null) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const send = () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (DELAY > 0) setTimeout(send, DELAY);
  else send();
}).listen(PORT, () => {
  console.log(`mock /v1 API on http://localhost:${PORT}`);
});
