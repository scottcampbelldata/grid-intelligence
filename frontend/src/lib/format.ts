// Number coercion + display formatting.
//
// The API serializes Postgres numeric/Decimal values (and EXTRACT(EPOCH ...)
// fields like sec_since_fetch / sec_since_period) as JSON *strings*. Every
// numeric field is therefore run through num() before use - not just the
// freshness fields - so the whole client is robust to string-vs-number.

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Timestamps come back named *_utc. If the string carries no timezone marker,
// interpret it as UTC rather than letting the browser assume local time.
export function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s.trim());
  const iso = hasTz ? s.trim() : `${s.trim().replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatInt(n: number | null): string {
  if (n === null) return "-";
  return Math.round(n).toLocaleString("en-US");
}

// Instantaneous power (MW averaged over the hour). Big network totals → GW.
export function formatPower(mw: number | null): { value: string; unit: string } {
  if (mw === null) return { value: "-", unit: "" };
  if (Math.abs(mw) >= 1_000) return { value: (mw / 1_000).toFixed(1), unit: "GW" };
  return { value: formatInt(mw), unit: "MW" };
}

// Energy (MWh summed over a window). Scales MWh → GWh → TWh.
export function formatEnergy(mwh: number | null): { value: string; unit: string } {
  if (mwh === null) return { value: "-", unit: "" };
  const abs = Math.abs(mwh);
  if (abs >= 1_000_000) return { value: (mwh / 1_000_000).toFixed(1), unit: "TWh" };
  if (abs >= 1_000) return { value: (mwh / 1_000).toFixed(1), unit: "GWh" };
  return { value: formatInt(mwh), unit: "MWh" };
}

export function formatPct(n: number | null, digits = 1): string {
  if (n === null) return "-";
  return `${n.toFixed(digits)}%`;
}

export function formatSignedPct(n: number | null, digits = 1): string {
  if (n === null) return "-";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

// Relative time from a raw seconds count (e.g. the API's sec_since_fetch).
export function agoFromSeconds(sec: number | null): string {
  if (sec === null) return "-";
  const s = Math.max(0, sec);
  if (s < 60) return "<1 min ago";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export function timeAgo(from: Date | null, now: Date): string {
  if (!from) return "-";
  const sec = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

// Y-axis tick in GW, with precision scaled to the tick magnitude so sub-1-GW
// systems don't collapse to "0" (PJM reads as whole GW; a small BA keeps
// meaningful decimals). Shared by the forecast charts.
export function formatGwTick(v: number): string {
  const g = v / 1_000;
  const abs = Math.abs(g);
  if (abs === 0) return "0";
  if (abs >= 10) return g.toFixed(0);
  if (abs >= 1) return g.toFixed(1);
  if (abs >= 0.1) return g.toFixed(2);
  return g.toFixed(3);
}

// Reverse "UTF-8 bytes mistakenly read as Windows-1252, then re-saved as UTF-8"
// mojibake (e.g. "≤" arriving as "â‰¤", em-dashes mangled) that the validation
// API currently emits. Maps each char back to its CP1252 byte and decodes the
// byte run as UTF-8; bails (returns the original) on anything that isn't this
// specific round-trip, so clean strings pass through untouched.
const CP1252_REV: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

export function demojibake(s: string): string {
  // The mojibake always leaves UTF-8 lead bytes showing as Â/Ã/â; skip otherwise.
  if (!/[ÂÃâ]/.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const b = CP1252_REV[cp] ?? cp;
    if (b > 0xff) return s; // not a single CP1252 byte → not this mojibake
    bytes.push(b);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

// X-axis tick: local time, 24h clock.
export function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
