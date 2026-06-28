// Typed API client for the Grid Intelligence FastAPI backend.
//
// Only the endpoints the Demand tab needs are implemented here; the remaining
// tabs will add their own functions following the same pattern:
//   1. a Raw* interface mirroring the JSON exactly (numbers may be strings),
//   2. a clean exported interface (real numbers / Date),
//   3. a fetch function that coerces with num() / parseUtc().

import { demojibake, num, parseUtc } from "./format";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787"
).replace(/\/+$/, "");

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // Average the two middle values for even-length input - a true median.
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// Source reporting lags (EIA/ENTSO-E publish the most recent hours late), so the
// last 1-3 hourly buckets in an aggregated series are often incomplete and dip
// toward zero - a misleading cliff. A trailing bucket is treated as incomplete
// when EITHER fewer contributors (BAs/fuels/zones) reported than a typical
// complete hour OR the network total has collapsed far below its stable
// baseline (these continental aggregates vary only ~±10% hour to hour, so a
// drop past 40% is reporting lag, not real load). Both thresholds are measured
// against the median bucket, which is robust to the incomplete tail. Only the
// consecutive trailing run is dropped - interior data is never touched - and we
// cap the trim at a few hours so a genuine dip is never mistaken for lag.
function dropTrailingIncomplete<T>(
  buckets: T[],
  metrics: (b: T) => { count: number; value: number },
): T[] {
  if (buckets.length < 4) return buckets;
  const m = buckets.map(metrics);
  const medCount = median(m.map((x) => x.count));
  const medValue = median(m.map((x) => x.value));
  if (medCount <= 0 || medValue <= 0) return buckets;
  const countThreshold = medCount * 0.9;
  const valueThreshold = medValue * 0.6;
  const maxTrim = Math.min(3, buckets.length - 2);
  let trim = 0;
  while (trim < maxTrim) {
    const x = m[buckets.length - 1 - trim];
    if (x.count < countThreshold || x.value < valueThreshold) trim++;
    else break;
  }
  return trim > 0 ? buckets.slice(0, buckets.length - trim) : buckets;
}

// ---------------------------------------------------------------------------
// GET /v1/demand/headline  →  one-shot "what's happening right now"
// ---------------------------------------------------------------------------
interface RawHeadline {
  as_of_utc: string | null;
  total_mwh_now: number | string | null;
  total_mwh_24h_ago: number | string | null;
  bas: number | string | null;
  delta_pct: number | string | null;
}

export interface DemandHeadline {
  asOf: Date | null;
  totalMwhNow: number | null;
  totalMwh24hAgo: number | null;
  bas: number | null;
  deltaPct: number | null;
}

export async function getDemandHeadline(signal?: AbortSignal): Promise<DemandHeadline> {
  const r = await getJson<RawHeadline>("/v1/demand/headline", signal);
  return {
    asOf: parseUtc(r.as_of_utc),
    totalMwhNow: num(r.total_mwh_now),
    totalMwh24hAgo: num(r.total_mwh_24h_ago),
    bas: num(r.bas),
    deltaPct: num(r.delta_pct),
  };
}

// ---------------------------------------------------------------------------
// GET /v1/demand/latest?hours=N  →  per-BA hourly demand, summed to a network
// time series for the chart.
// ---------------------------------------------------------------------------
interface RawDemandPoint {
  period_utc: string;
  ba_code: string;
  value_mwh: number | string | null;
}

export interface DemandSeriesPoint {
  t: number; // epoch ms (hour bucket)
  mwh: number; // network total (hourly MWh ≡ avg MW) across all balancing authorities
}

export interface BaDemand {
  baCode: string;
  avgMw: number; // mean demand over the window (hourly MWh ≡ avg MW)
}

export interface DemandBundle {
  series: DemandSeriesPoint[];
  byBa: BaDemand[]; // sorted by avgMw, descending
  // Per-BA hourly demand (MWh ≡ avg MW), aligned to the same trimmed hour
  // buckets as `series` and `times`, for the multi-BA comparison overlay.
  // Keyed ba_code → (epoch ms → mwh); a missing hour means that BA didn't report.
  byBaSeries: Record<string, Record<number, number>>;
  times: number[]; // the trimmed hour buckets, ascending (== series.map(s => s.t))
}

// Fetches /v1/demand/latest once and derives the network time series, the
// per-balancing-authority averages (top-BA bar chart), and per-BA hourly series
// (comparison overlay) from the same rows - one request, several views.
export async function getDemand(hours = 24, signal?: AbortSignal): Promise<DemandBundle> {
  const rows = await getJson<RawDemandPoint[]>(`/v1/demand/latest?hours=${hours}`, signal);
  // Track BAs reporting per hour alongside the total so we can trim the
  // trailing incomplete buckets (fewer BAs reported = source lag, not a real dip).
  const byHour = new Map<number, { mwh: number; bas: number }>();
  const baAgg = new Map<string, { sum: number; n: number }>();
  const baByHour = new Map<string, Map<number, number>>(); // ba → (t → mwh)
  for (const row of rows) {
    const d = parseUtc(row.period_utc);
    const v = num(row.value_mwh);
    if (!d || v === null) continue;
    const t = d.getTime();
    const h = byHour.get(t) ?? { mwh: 0, bas: 0 };
    h.mwh += v;
    h.bas += 1;
    byHour.set(t, h);
    const cur = baAgg.get(row.ba_code) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    baAgg.set(row.ba_code, cur);
    let bm = baByHour.get(row.ba_code);
    if (!bm) {
      bm = new Map();
      baByHour.set(row.ba_code, bm);
    }
    bm.set(t, (bm.get(t) ?? 0) + v);
  }
  const ordered = [...byHour.entries()].sort((a, b) => a[0] - b[0]);
  const series = dropTrailingIncomplete(ordered, ([, h]) => ({
    count: h.bas,
    value: h.mwh,
  })).map(([t, h]) => ({ t, mwh: h.mwh }));
  const byBa = [...baAgg.entries()]
    .map(([baCode, s]) => ({ baCode, avgMw: s.n > 0 ? s.sum / s.n : 0 }))
    .sort((a, b) => b.avgMw - a.avgMw);

  // Align per-BA series to the trimmed network hours so every comparison line
  // ends at the same clean point as the network chart.
  const times = series.map((s) => s.t);
  const validTimes = new Set(times);
  const byBaSeries: Record<string, Record<number, number>> = {};
  for (const [ba, bm] of baByHour) {
    const rec: Record<number, number> = {};
    for (const [t, v] of bm) if (validTimes.has(t)) rec[t] = v;
    byBaSeries[ba] = rec;
  }

  return { series, byBa, byBaSeries, times };
}

// ---------------------------------------------------------------------------
// GET /v1/generation/share?hours=N  →  per-fuel share with renewable /
// carbon-free flags. We roll it up to network totals for the KPI cards.
// ---------------------------------------------------------------------------
interface RawShare {
  fuel_code: string;
  fuel_name: string | null;
  is_renewable: boolean | null;
  is_carbon_free: boolean | null;
  mwh: number | string | null;
  pct: number | string | null;
}

export interface GenerationShareRow {
  fuelCode: string;
  fuelName: string;
  isRenewable: boolean;
  isCarbonFree: boolean;
  mwh: number | null;
  pct: number | null;
}

export interface GenerationSummary {
  rows: GenerationShareRow[];
  totalMwh: number | null;
  carbonFreePct: number | null;
  renewablePct: number | null;
}

export async function getGenerationShare(
  hours = 24,
  signal?: AbortSignal,
): Promise<GenerationSummary> {
  const raw = await getJson<RawShare[]>(`/v1/generation/share?hours=${hours}`, signal);
  const rows: GenerationShareRow[] = raw.map((r) => ({
    fuelCode: r.fuel_code,
    fuelName: r.fuel_name ?? r.fuel_code,
    isRenewable: Boolean(r.is_renewable),
    isCarbonFree: Boolean(r.is_carbon_free),
    mwh: num(r.mwh),
    pct: num(r.pct),
  }));
  if (rows.length === 0) {
    return { rows, totalMwh: null, carbonFreePct: null, renewablePct: null };
  }
  const totalMwh = rows.reduce((s, r) => s + (r.mwh ?? 0), 0);
  const carbonFreePct = rows
    .filter((r) => r.isCarbonFree)
    .reduce((s, r) => s + (r.pct ?? 0), 0);
  const renewablePct = rows
    .filter((r) => r.isRenewable)
    .reduce((s, r) => s + (r.pct ?? 0), 0);
  return { rows, totalMwh, carbonFreePct, renewablePct };
}

// ---------------------------------------------------------------------------
// GET /v1/generation/mix?hours=N (+ /share)  →  stacked generation-by-fuel time
// series, grouped into the top fuels + "Other" so we never spray 15 bands.
// ---------------------------------------------------------------------------
interface RawGenPoint {
  period_utc: string;
  fuel_code: string;
  value_mwh: number | string | null;
}

export interface GenBand {
  code: string; // fuel_code, or "__other__"
  label: string; // display name; the stacked series is keyed by this
}

// A stacked point: { t, [bandLabel]: mwh, ... } with every band present.
export type GenStackPoint = { t: number } & Record<string, number>;

export interface GenerationData {
  share: GenerationSummary;
  bands: GenBand[]; // ordered largest-first; last is "Other" when fuels were grouped
  series: GenStackPoint[];
}

// Cap on named fuel bands - matches the stacked-chart palette size so every
// band gets a distinct color (8 named + one "Other" = 9 areas, still legible).
const MAX_NAMED = 8;
// A non-primary fuel earns its own band when its 24h share clears this, so
// meaningful sources (e.g. Battery ~3%, Geothermal ~1.5%) don't bloat "Other".
const SHARE_THRESHOLD_PCT = 1.5;

// Primary generation fuels - always shown as their own band when present, even
// at low volume, because they're what the carbon-free / renewable KPIs are about
// and what an exec expects to see (Solar especially keeps its own band rather
// than vanishing into "Other" overnight).
const PRIMARY_FUELS = ["NG", "NUC", "COL", "WAT", "WND", "SUN"];
const OTHER_LABEL = "Other";

// Friendly display names for fuel codes the source returns without a name (it
// leaves storage codes null). Lets us name them when they're significant
// instead of showing a bare code like "BAT".
const FUEL_LABEL_OVERRIDES: Record<string, string> = {
  BAT: "Battery",
  PS: "Pumped Storage",
};

function displayLabel(r: GenerationShareRow): string {
  return FUEL_LABEL_OVERRIDES[r.fuelCode] ?? r.fuelName;
}
// The source itself emits a catch-all bucket (code OTH, name "Other"). It must
// never become a named band: it would both consume a slot (pushing real fuels
// like Solar out) and collide with our synthetic tail bucket, yielding two
// same-named "Other" series. Fold it into the single Other instead.
function isCatchAllOther(r: GenerationShareRow): boolean {
  return r.fuelCode === "OTH" || r.fuelName.trim().toLowerCase() === OTHER_LABEL.toLowerCase();
}
// Whether a fuel has a presentable name (backend-provided or an override) - keeps
// unlabeled, uncategorized codes (e.g. SNB) out of named bands even if they grow.
function isPresentable(r: GenerationShareRow): boolean {
  return r.fuelCode in FUEL_LABEL_OVERRIDES || r.fuelName !== r.fuelCode;
}

export async function getGeneration(
  hours = 24,
  signal?: AbortSignal,
): Promise<GenerationData> {
  const [share, mixRows] = await Promise.all([
    getGenerationShare(hours, signal),
    getJson<RawGenPoint[]>(`/v1/generation/mix?hours=${hours}`, signal),
  ]);

  // Pick the named fuel bands: every primary fuel that's present, plus any other
  // presentable fuel whose 24h share clears SHARE_THRESHOLD_PCT (so meaningful
  // sources like Battery and Geothermal get their own band instead of inflating
  // "Other"), capped at MAX_NAMED and ordered largest-first. The source catch-all
  // "Other" is excluded so it can't take a slot or duplicate our tail bucket.
  const byVol = (a: GenerationShareRow, b: GenerationShareRow) => (b.mwh ?? 0) - (a.mwh ?? 0);
  const eligible = share.rows.filter((r) => !isCatchAllOther(r));
  const primaries = eligible.filter((r) => PRIMARY_FUELS.includes(r.fuelCode));
  const significant = eligible.filter(
    (r) =>
      !PRIMARY_FUELS.includes(r.fuelCode) &&
      isPresentable(r) &&
      (r.pct ?? 0) >= SHARE_THRESHOLD_PCT,
  );
  // Primaries first so they're never dropped if the cap binds; both by volume.
  const chosen = [...primaries.sort(byVol), ...significant.sort(byVol)]
    .slice(0, MAX_NAMED)
    .sort(byVol);

  const codeToLabel = new Map(share.rows.map((r) => [r.fuelCode, displayLabel(r)]));
  const namedCodes = new Set(chosen.map((r) => r.fuelCode));
  const bands: GenBand[] = chosen.map((r) => ({ code: r.fuelCode, label: displayLabel(r) }));
  // Exactly one "Other" for everything outside the named set (the source
  // catch-all + sub-threshold tail + uncategorized codes), added only when
  // something lands there.
  const hasOther = share.rows.some((r) => !namedCodes.has(r.fuelCode));
  if (hasOther) bands.push({ code: "__other__", label: OTHER_LABEL });

  const byHour = new Map<number, GenStackPoint>();
  // Per hour: contributing fuel rows and the network total - both feed the
  // trailing-incomplete trim (fuel count catches dropped fuels; total catches
  // hours where every fuel is present but fewer BAs within them reported).
  const completeness = new Map<number, { count: number; value: number }>();
  for (const row of mixRows) {
    const d = parseUtc(row.period_utc);
    const v = num(row.value_mwh);
    if (!d || v === null) continue;
    const t = d.getTime();
    let pt = byHour.get(t);
    if (!pt) {
      pt = { t } as GenStackPoint;
      for (const b of bands) pt[b.label] = 0;
      byHour.set(t, pt);
    }
    const c = completeness.get(t) ?? { count: 0, value: 0 };
    c.count += 1;
    c.value += v;
    completeness.set(t, c);
    const label = namedCodes.has(row.fuel_code)
      ? (codeToLabel.get(row.fuel_code) ?? row.fuel_code)
      : OTHER_LABEL;
    // If nothing fell outside the named set there is no "Other" band; the
    // `label in pt` guard skips such rows safely.
    if (label in pt) pt[label] += v;
  }

  const ordered = [...byHour.values()].sort((a, b) => a.t - b.t);
  const series = dropTrailingIncomplete(
    ordered,
    (pt) => completeness.get(pt.t) ?? { count: 0, value: 0 },
  );
  return { share, bands, series };
}

// ---------------------------------------------------------------------------
// GET /v1/interchange/flows?hours=N  →  net power flows between balancing
// authorities. NOTE: frequently returns [] because of EIA's ~29h publishing
// lag - callers must handle the empty case explicitly.
// ---------------------------------------------------------------------------
interface RawFlow {
  from_ba: string;
  to_ba: string;
  net_mwh: number | string | null;
  n_obs: number | string | null;
}

export interface InterchangeFlow {
  fromBa: string;
  toBa: string;
  netMw: number; // net flow from→to over the window (avg MW); sign = direction
  nObs: number;
}

export async function getInterchange(
  hours = 24,
  signal?: AbortSignal,
): Promise<InterchangeFlow[]> {
  const rows = await getJson<RawFlow[]>(`/v1/interchange/flows?hours=${hours}`, signal);
  return rows
    .map((r) => ({
      fromBa: r.from_ba,
      toBa: r.to_ba,
      netMw: num(r.net_mwh) ?? 0,
      nObs: num(r.n_obs) ?? 0,
    }))
    .filter((f) => f.fromBa && f.toBa);
}

// ---------------------------------------------------------------------------
// GET /v1/anomalies/recent?hours=N  →  detected demand anomalies.
// ---------------------------------------------------------------------------
interface RawAnomaly {
  period_utc: string;
  ba_code: string;
  actual_mwh: number | string | null;
  expected_mwh: number | string | null;
  residual_mwh: number | string | null;
  z_score: number | string | null;
  severity: string | null;
}

export interface Anomaly {
  periodUtc: Date | null;
  baCode: string;
  actualMwh: number | null;
  expectedMwh: number | null;
  residualMwh: number | null;
  zScore: number | null;
  severity: string;
}

export async function getRecentAnomalies(
  hours = 24,
  signal?: AbortSignal,
): Promise<Anomaly[]> {
  const rows = await getJson<RawAnomaly[]>(`/v1/anomalies/recent?hours=${hours}`, signal);
  return rows.map((r) => ({
    periodUtc: parseUtc(r.period_utc),
    baCode: r.ba_code,
    actualMwh: num(r.actual_mwh),
    expectedMwh: num(r.expected_mwh),
    residualMwh: num(r.residual_mwh),
    zScore: num(r.z_score),
    severity: r.severity ?? "unknown",
  }));
}

// ---------------------------------------------------------------------------
// GET /v1/balancing-authorities  →  BA codes (for the forecast selector).
// ---------------------------------------------------------------------------
export async function getBalancingAuthorities(signal?: AbortSignal): Promise<string[]> {
  const rows = await getJson<Array<{ ba_code: string }>>("/v1/balancing-authorities", signal);
  return rows.map((r) => r.ba_code).filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// GET /v1/forecast/{ba_code}  →  realized actuals (72h) + SARIMAX forecast with
// yhat and a yhat_lower/yhat_upper confidence band. Merged into one timeline.
// ---------------------------------------------------------------------------
interface RawForecastResp {
  ba_code: string;
  actual: Array<{ period_utc: string; value_mwh: number | string | null }>;
  forecast: Array<{
    period_utc: string;
    yhat_mwh: number | string | null;
    yhat_lower: number | string | null;
    yhat_upper: number | string | null;
    model_name: string | null;
  }>;
}

export interface ForecastPoint {
  t: number;
  actual: number | null;
  yhat: number | null;
  lower: number | null;
  upper: number | null;
}

export interface ForecastData {
  baCode: string;
  modelName: string | null;
  points: ForecastPoint[];
  lastActual: { t: number; mwh: number } | null;
  firstForecast: { t: number; yhat: number } | null;
  peakForecast: { t: number; yhat: number } | null;
  horizonHours: number;
  boundaryT: number | null; // last actual timestamp - the history/forecast divider
}

export async function getForecast(
  baCode: string,
  signal?: AbortSignal,
): Promise<ForecastData> {
  const resp = await getJson<RawForecastResp>(
    `/v1/forecast/${encodeURIComponent(baCode)}`,
    signal,
  );

  const byT = new Map<number, ForecastPoint>();
  const ensure = (t: number): ForecastPoint => {
    let p = byT.get(t);
    if (!p) {
      p = { t, actual: null, yhat: null, lower: null, upper: null };
      byT.set(t, p);
    }
    return p;
  };

  let lastActual: { t: number; mwh: number } | null = null;
  for (const a of resp.actual ?? []) {
    const d = parseUtc(a.period_utc);
    const v = num(a.value_mwh);
    if (!d || v === null) continue;
    const t = d.getTime();
    ensure(t).actual = v;
    if (!lastActual || t > lastActual.t) lastActual = { t, mwh: v };
  }

  let firstForecast: { t: number; yhat: number } | null = null;
  let peakForecast: { t: number; yhat: number } | null = null;
  let horizonHours = 0;
  for (const f of resp.forecast ?? []) {
    const d = parseUtc(f.period_utc);
    if (!d) continue;
    const t = d.getTime();
    const p = ensure(t);
    const y = num(f.yhat_mwh);
    p.yhat = y;
    p.lower = num(f.yhat_lower);
    p.upper = num(f.yhat_upper);
    if (y !== null) {
      horizonHours += 1;
      if (!firstForecast || t < firstForecast.t) firstForecast = { t, yhat: y };
      if (!peakForecast || y > peakForecast.yhat) peakForecast = { t, yhat: y };
    }
  }

  const points = [...byT.values()].sort((a, b) => a.t - b.t);
  const modelName = (resp.forecast ?? []).find((f) => f.model_name)?.model_name ?? null;

  return {
    baCode: resp.ba_code ?? baCode,
    modelName,
    points,
    lastActual,
    firstForecast,
    peakForecast,
    horizonHours,
    boundaryT: lastActual?.t ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /v1/weather/latest  →  NOAA gridpoint FORECAST per BA centroid (future-
// dated, not current observations). station_id is "BA:<code>" - strip the
// prefix. NOTE: lat/lon exist in raw.weather_station but aren't exposed here,
// so a map view needs the API to surface coordinates first.
// ---------------------------------------------------------------------------
interface RawWeather {
  station_id: string;
  period_utc: string;
  temperature_c: number | string | null;
  wind_speed_kph: number | string | null;
  cloud_cover_pct: number | string | null;
  short_forecast: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface WeatherStation {
  baCode: string;
  periodUtc: Date | null;
  tempC: number | null;
  windKph: number | null;
  cloudPct: number | null;
  conditions: string;
  lat: number | null;
  lon: number | null;
}

// ---------------------------------------------------------------------------
// GET /v1/europe/load?hours=N  →  ENTSO-E load per bidding zone. The API returns
// raw EIC codes; map them to readable zone names (mapping mirrors the backend's
// DEFAULT_ZONES). Grouped to top-N zones + "Other" for a legible stacked chart.
// ---------------------------------------------------------------------------
const EIC_ZONE_NAMES: Record<string, string> = {
  "10YDE-VE-------2": "Germany (50Hertz)",
  "10YFR-RTE------C": "France",
  "10YGB----------A": "Great Britain",
  "10YES-REE------0": "Spain",
  "10YIT-GRTN-----B": "Italy (North)",
  "10YNL----------L": "Netherlands",
  "10YBE----------2": "Belgium",
  "10YPT-REN------W": "Portugal",
  "10YPL-AREA-----S": "Poland",
  "10YAT-APG------L": "Austria",
  "10YCH-SWISSGRIDZ": "Switzerland",
  "10YDK-1--------W": "Denmark (DK1)",
  "10YDK-2--------M": "Denmark (DK2)",
  "10YNO-2--------T": "Norway (NO2)",
  "10YSE-1--------K": "Sweden (SE1)",
  "10YFI-1--------U": "Finland",
  "10YIE-1001A00010": "Ireland",
  "10YCZ-CEPS-----N": "Czech Republic",
  "10YHU-MAVIR----U": "Hungary",
  "10YGR-HTSO-----Y": "Greece",
};

export function zoneName(eic: string): string {
  return EIC_ZONE_NAMES[eic] ?? eic;
}

interface RawEuropeLoad {
  period_utc: string;
  bidding_zone: string;
  value_mw: number | string | null;
}

export interface EuropeZone {
  zone: string; // EIC code
  name: string;
  avgMw: number;
  totalMwh: number;
}

export interface EuropeData {
  bands: GenBand[]; // top zones + "Other", largest first
  series: GenStackPoint[];
  zones: EuropeZone[]; // all zones, sorted by avg load desc
  totalMwh: number;
  peakTotalMw: number;
}

const TOP_ZONES = 6;

export async function getEurope(hours = 24, signal?: AbortSignal): Promise<EuropeData> {
  const rows = await getJson<RawEuropeLoad[]>(`/v1/europe/load?hours=${hours}`, signal);

  const zoneAgg = new Map<string, { sum: number; n: number }>();
  const byHour = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const d = parseUtc(r.period_utc);
    const v = num(r.value_mw);
    if (!d || v === null || !r.bidding_zone) continue;
    const t = d.getTime();
    const agg = zoneAgg.get(r.bidding_zone) ?? { sum: 0, n: 0 };
    agg.sum += v;
    agg.n += 1;
    zoneAgg.set(r.bidding_zone, agg);
    let m = byHour.get(t);
    if (!m) {
      m = new Map();
      byHour.set(t, m);
    }
    m.set(r.bidding_zone, (m.get(r.bidding_zone) ?? 0) + v);
  }

  const zones: EuropeZone[] = [...zoneAgg.entries()]
    .map(([zone, a]) => ({
      zone,
      name: zoneName(zone),
      avgMw: a.n > 0 ? a.sum / a.n : 0,
      totalMwh: a.sum,
    }))
    .sort((a, b) => b.avgMw - a.avgMw);

  const top = zones.slice(0, TOP_ZONES);
  const topZones = new Set(top.map((z) => z.zone));
  const bands: GenBand[] = top.map((z) => ({ code: z.zone, label: z.name }));
  if (zones.length > TOP_ZONES) bands.push({ code: "__other__", label: "Other" });

  const orderedHours = [...byHour.entries()].sort((a, b) => a[0] - b[0]);
  // Trim trailing incomplete hours (fewer zones reported = ENTSO-E publish lag).
  const series: GenStackPoint[] = dropTrailingIncomplete(orderedHours, ([, m]) => ({
    count: m.size,
    value: [...m.values()].reduce((s, v) => s + v, 0),
  })).map(([t, m]) => {
    const pt = { t } as GenStackPoint;
    for (const b of bands) pt[b.label] = 0;
    for (const [zone, v] of m) {
      const label = topZones.has(zone) ? zoneName(zone) : "Other";
      if (label in pt) pt[label] += v;
    }
    return pt;
  });

  const totalMwh = zones.reduce((s, z) => s + z.totalMwh, 0);
  let peakTotalMw = 0;
  for (const m of byHour.values()) {
    let tot = 0;
    for (const v of m.values()) tot += v;
    if (tot > peakTotalMw) peakTotalMw = tot;
  }

  return { bands, series, zones, totalMwh, peakTotalMw };
}

// ---------------------------------------------------------------------------
// GET /v1/freshness + /v1/ingest-runs  →  pipeline health. NOTE: sec_since_fetch
// and sec_since_period come back as JSON strings - coerce with num() (parseFloat).
// ---------------------------------------------------------------------------
interface RawFreshness {
  source: string;
  last_period_utc: string | null;
  last_fetch_utc: string | null;
  last_rows: number | string | null;
  last_error: string | null;
  sec_since_fetch: number | string | null;
  sec_since_period: number | string | null;
}

export type SourceStatus = "ok" | "stale" | "error";

export interface SourceFreshness {
  source: string;
  lastPeriodUtc: Date | null;
  lastFetchUtc: Date | null;
  lastRows: number | null;
  lastError: string | null;
  secSinceFetch: number | null;
  secSincePeriod: number | null;
  status: SourceStatus;
}

// No fetch in 3h is treated as stale (covers hourly + 15-min sources with buffer).
const STALE_AFTER_SEC = 3 * 3600;

function freshnessStatus(secSinceFetch: number | null, lastError: string | null): SourceStatus {
  if (lastError && lastError.trim()) return "error";
  if (secSinceFetch === null || secSinceFetch > STALE_AFTER_SEC) return "stale";
  return "ok";
}

export async function getFreshness(signal?: AbortSignal): Promise<SourceFreshness[]> {
  const rows = await getJson<RawFreshness[]>("/v1/freshness", signal);
  return rows.map((r) => {
    const secSinceFetch = num(r.sec_since_fetch);
    return {
      source: r.source,
      lastPeriodUtc: parseUtc(r.last_period_utc),
      lastFetchUtc: parseUtc(r.last_fetch_utc),
      lastRows: num(r.last_rows),
      lastError: r.last_error,
      secSinceFetch,
      secSincePeriod: num(r.sec_since_period),
      status: freshnessStatus(secSinceFetch, r.last_error),
    };
  });
}

interface RawIngestRun {
  source: string;
  started_at: string | null;
  finished_at: string | null;
  rows_written: number | string | null;
  status: string | null;
  error_message: string | null;
}

export interface IngestRun {
  source: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowsWritten: number | null;
  status: string;
  errorMessage: string | null;
}

export async function getIngestRuns(limit = 20, signal?: AbortSignal): Promise<IngestRun[]> {
  const rows = await getJson<RawIngestRun[]>(`/v1/ingest-runs?limit=${limit}`, signal);
  return rows.map((r) => ({
    source: r.source,
    startedAt: parseUtc(r.started_at),
    finishedAt: parseUtc(r.finished_at),
    rowsWritten: num(r.rows_written),
    status: r.status ?? "unknown",
    errorMessage: r.error_message,
  }));
}

export async function getWeather(signal?: AbortSignal): Promise<WeatherStation[]> {
  const rows = await getJson<RawWeather[]>("/v1/weather/latest", signal);
  return rows
    .map((r) => ({
      baCode: (r.station_id ?? "").replace(/^BA:/i, ""),
      periodUtc: parseUtc(r.period_utc),
      tempC: num(r.temperature_c),
      windKph: num(r.wind_speed_kph),
      cloudPct: num(r.cloud_cover_pct),
      conditions: r.short_forecast?.trim() || "-",
      lat: num(r.latitude),
      lon: num(r.longitude),
    }))
    .filter((s) => s.baCode)
    .sort((a, b) => a.baCode.localeCompare(b.baCode));
}

// ---------------------------------------------------------------------------
// GET /v1/europe/weather  →  Open-Meteo FORECAST per European bidding-zone
// centroid (future-dated, CC BY 4.0). Same shape as /v1/weather/latest, plus a
// readable zone_name and latitude/longitude per zone. station_id is
// "EU:<EIC>" - strip the prefix.
// ---------------------------------------------------------------------------
interface RawEuropeWeather {
  station_id: string;
  period_utc: string;
  temperature_c: number | string | null;
  wind_speed_kph: number | string | null;
  cloud_cover_pct: number | string | null;
  short_forecast: string | null;
  zone_name: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface EuropeWeatherZone {
  zone: string; // EIC code, e.g. 10YAT-APG------L
  name: string; // readable zone name from the API
  periodUtc: Date | null;
  tempC: number | null;
  windKph: number | null;
  cloudPct: number | null;
  conditions: string;
  lat: number | null;
  lon: number | null;
}

export async function getEuropeWeather(signal?: AbortSignal): Promise<EuropeWeatherZone[]> {
  const rows = await getJson<RawEuropeWeather[]>("/v1/europe/weather", signal);
  return rows
    .map((r) => {
      const zone = (r.station_id ?? "").replace(/^EU:/i, "");
      return {
        zone,
        name: r.zone_name?.trim() || zoneName(zone),
        periodUtc: parseUtc(r.period_utc),
        tempC: num(r.temperature_c),
        windKph: num(r.wind_speed_kph),
        cloudPct: num(r.cloud_cover_pct),
        conditions: r.short_forecast?.trim() || "-",
        lat: num(r.latitude),
        lon: num(r.longitude),
      };
    })
    .filter((s) => s.zone)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// GET /v1/validation  →  data-quality checks. Each check has a status, a
// human-readable value/threshold/explanation, count rollups, and (for some
// checks) per-BA details. NOTE: the API currently double-encodes some text
// fields (≤, em-dashes) - demojibake() repairs them.
// ---------------------------------------------------------------------------
export type ValidationStatus = "pass" | "warn" | "fail";

// Per-BA detail rows vary in shape by check (energy_balance vs fuel_shares), so
// we keep them as loose records and render columns dynamically. Always carries
// a per-row `status`.
export type ValidationDetail = Record<string, string | number | null>;

export interface ValidationCheck {
  name: string;
  status: ValidationStatus;
  value: string;
  threshold: string;
  unit: string;
  explanation: string;
  counts: Record<string, number>;
  details: ValidationDetail[];
}

export interface ValidationReport {
  asOf: Date | null;
  summary: { pass: number; warn: number; fail: number };
  checks: ValidationCheck[];
}

interface RawValidationCheck {
  name: string;
  status: string | null;
  value: string | null;
  threshold: string | null;
  unit: string | null;
  explanation: string | null;
  counts: Record<string, number> | null;
  details: Array<Record<string, unknown>> | null;
}
interface RawValidation {
  as_of_utc: string | null;
  summary: { pass: number; warn: number; fail: number } | null;
  checks: RawValidationCheck[] | null;
}

function asValidationStatus(s: string | null | undefined): ValidationStatus {
  return s === "fail" || s === "warn" ? s : "pass";
}

export async function getValidation(signal?: AbortSignal): Promise<ValidationReport> {
  const r = await getJson<RawValidation>("/v1/validation", signal);
  const checks: ValidationCheck[] = (r.checks ?? []).map((c) => ({
    name: c.name,
    status: asValidationStatus(c.status),
    value: demojibake((c.value ?? "").trim()),
    threshold: demojibake((c.threshold ?? "").trim()),
    unit: c.unit ?? "",
    explanation: demojibake((c.explanation ?? "").trim()),
    counts: c.counts ?? {},
    details: (c.details ?? []) as unknown as ValidationDetail[],
  }));
  return {
    asOf: parseUtc(r.as_of_utc),
    summary: r.summary ?? { pass: 0, warn: 0, fail: 0 },
    checks,
  };
}

// ---------------------------------------------------------------------------
// GET /v1/forecast/accuracy?hours=N&ba_code=  →  out-of-sample backtest of our
// SARIMAX vs EIA's day-ahead, overall and per-BA.
// ---------------------------------------------------------------------------
export interface AccuracyPerBa {
  baCode: string;
  pairs: number;
  mapePct: number | null;
  rmseMwh: number | null;
}
export interface AccuracySource {
  source: string; // raw id, e.g. "sarimax" | "eia_day_ahead"
  label: string; // display label
  pairs: number;
  mapePct: number | null;
  rmseMwh: number | null;
  perBa: AccuracyPerBa[];
}
export interface AccuracyReport {
  windowHours: number | null;
  baCode: string | null;
  metricNotes: string;
  sources: AccuracySource[];
}

interface RawAccuracyPerBa {
  ba_code: string;
  pairs: number | string | null;
  mape_pct: number | string | null;
  rmse_mwh: number | string | null;
}
interface RawAccuracySource {
  source: string | null;
  pairs: number | string | null;
  mape_pct: number | string | null;
  rmse_mwh: number | string | null;
  per_ba: RawAccuracyPerBa[] | null;
}
interface RawAccuracy {
  window: { hours: number | string | null } | null;
  ba_code: string | null;
  metric_notes: string | null;
  sources: RawAccuracySource[] | null;
}

const ACCURACY_LABELS: Record<string, string> = {
  sarimax: "SARIMAX",
  eia_day_ahead: "EIA day-ahead",
};

export async function getForecastAccuracy(
  hours = 168,
  baCode?: string,
  signal?: AbortSignal,
): Promise<AccuracyReport> {
  const q = new URLSearchParams({ hours: String(hours) });
  if (baCode) q.set("ba_code", baCode);
  const r = await getJson<RawAccuracy>(`/v1/forecast/accuracy?${q.toString()}`, signal);
  const sources: AccuracySource[] = (r.sources ?? []).map((s) => ({
    source: s.source ?? "",
    label: ACCURACY_LABELS[s.source ?? ""] ?? s.source ?? "-",
    pairs: num(s.pairs) ?? 0,
    mapePct: num(s.mape_pct),
    rmseMwh: num(s.rmse_mwh),
    perBa: (s.per_ba ?? []).map((p) => ({
      baCode: p.ba_code,
      pairs: num(p.pairs) ?? 0,
      mapePct: num(p.mape_pct),
      rmseMwh: num(p.rmse_mwh),
    })),
  }));
  return {
    windowHours: num(r.window?.hours ?? null),
    baCode: r.ba_code,
    metricNotes: demojibake((r.metric_notes ?? "").trim()),
    sources,
  };
}
