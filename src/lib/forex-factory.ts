// ===================================================================
// forex-factory.ts — Fetch + parse + filter + format Forex Factory calendar
// ===================================================================
// Source : https://nfs.faireconomy.media/ff_calendar_thisweek.json
//          (FairEconomy CDN — mirror ของ Forex Factory)
//
// Item shape:
//   { title, country, date (ISO -04:00), impact, forecast, previous }
//
// Time zone หลักของระบบ = UTC+7 (Thailand) — ตรงกับ TradingView alerts
// ===================================================================

const FF_FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export type Impact = "Low" | "Medium" | "High" | "Holiday";

export interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: Impact;
  forecast: string;
  previous: string;
}

const IMPACT_RANK: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Holiday: 0,
};

const IMPACT_EMOJI: Record<string, string> = {
  Low: "🟡",
  Medium: "🟠",
  High: "🔴",
  Holiday: "⚪",
};

const COUNTRY_EMOJI: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  AUD: "🇦🇺",
  NZD: "🇳🇿",
  CAD: "🇨🇦",
  CHF: "🇨🇭",
  CNY: "🇨🇳",
};

// ------------------- Fetch -------------------

export async function fetchWeek(): Promise<FFEvent[]> {
  // Cache 60s ที่ Next.js layer → ลดโหลด FairEconomy CDN
  // (cron ทุก 5 นาทีจะ hit cache ส่วนใหญ่ — feed อัปเดตแค่ตอนต้นสัปดาห์)
  const res = await fetch(FF_FEED_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (line-webhook-proxy)" },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Forex Factory feed HTTP ${res.status}`);
  }
  const data = (await res.json()) as FFEvent[];
  if (!Array.isArray(data)) {
    throw new Error("Forex Factory feed payload not an array");
  }
  return data;
}

// ------------------- Filters -------------------

export function filterByImpact(
  events: FFEvent[],
  minImpact: Impact = "Medium",
): FFEvent[] {
  const min = IMPACT_RANK[minImpact] ?? 2;
  return events.filter((e) => (IMPACT_RANK[e.impact] ?? 0) >= min);
}

export function filterByCurrency(
  events: FFEvent[],
  currencies: string[],
): FFEvent[] {
  if (!currencies.length) return events;
  const set = new Set(currencies.map((c) => c.toUpperCase()));
  return events.filter((e) => set.has(e.country.toUpperCase()));
}

/** Filter by [start, end) interval in absolute UTC ms. */
export function filterByTimeRange(
  events: FFEvent[],
  startMs: number,
  endMs: number,
): FFEvent[] {
  return events.filter((e) => {
    const t = new Date(e.date).getTime();
    return !Number.isNaN(t) && t >= startMs && t < endMs;
  });
}

/** Filter เฉพาะ event ของ "วันนี้" ตาม timezone UTC+offset (ชั่วโมง). */
export function filterByDay(
  events: FFEvent[],
  refMs: number = Date.now(),
  tzOffsetHours = 7,
): FFEvent[] {
  const tzMs = tzOffsetHours * 3600 * 1000;
  const dayStart = Math.floor((refMs + tzMs) / 86400000) * 86400000 - tzMs;
  const dayEnd = dayStart + 86400000;
  return filterByTimeRange(events, dayStart, dayEnd);
}

// ------------------- Format helpers -------------------

function fmtTime(iso: string, tzOffsetHours = 7): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??";
  const local = new Date(d.getTime() + tzOffsetHours * 3600 * 1000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDayLabel(ms: number, tzOffsetHours = 7): string {
  const local = new Date(ms + tzOffsetHours * 3600 * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[local.getUTCDay()];
  const date = String(local.getUTCDate()).padStart(2, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${day} ${date}/${month}`;
}

function fmtLine(e: FFEvent, tzOffsetHours = 7): string {
  const time = fmtTime(e.date, tzOffsetHours);
  const cc = COUNTRY_EMOJI[e.country.toUpperCase()] ?? e.country;
  const imp = IMPACT_EMOJI[e.impact] ?? "";
  const fc = e.forecast ? ` F:${e.forecast}` : "";
  const pv = e.previous ? ` P:${e.previous}` : "";
  return `${time} ${imp} ${cc} ${e.title}${fc}${pv}`;
}

// ------------------- Public formatters -------------------

export function formatDaySummary(
  events: FFEvent[],
  refMs: number = Date.now(),
  tzOffsetHours = 7,
): string {
  if (!events.length) {
    return `📅 ข่าวประจำวัน ${fmtDayLabel(refMs, tzOffsetHours)}\n— ไม่มีข่าวสำคัญ —`;
  }
  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const lines = sorted.map((e) => fmtLine(e, tzOffsetHours));
  return [
    `📅 ข่าวประจำวัน ${fmtDayLabel(refMs, tzOffsetHours)} (UTC+${tzOffsetHours})`,
    ...lines,
  ].join("\n");
}

export function formatWeekSummary(
  events: FFEvent[],
  tzOffsetHours = 7,
): string {
  if (!events.length) {
    return "📰 ข่าวประจำสัปดาห์\n— ไม่มีข่าวสำคัญ —";
  }
  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const groups = new Map<string, FFEvent[]>();
  for (const ev of sorted) {
    const localMs =
      new Date(ev.date).getTime() + tzOffsetHours * 3600 * 1000;
    const dayKey = Math.floor(localMs / 86400000).toString();
    const arr = groups.get(dayKey) ?? [];
    arr.push(ev);
    groups.set(dayKey, arr);
  }
  const blocks: string[] = [`📰 ข่าวสำคัญสัปดาห์นี้ (UTC+${tzOffsetHours})`];
  for (const [dayKey, items] of groups) {
    const dayMs = parseInt(dayKey, 10) * 86400000 - tzOffsetHours * 3600 * 1000;
    blocks.push(`\n— ${fmtDayLabel(dayMs, tzOffsetHours)} —`);
    for (const ev of items) blocks.push(fmtLine(ev, tzOffsetHours));
  }
  return blocks.join("\n");
}

export function formatPreAlert(e: FFEvent, tzOffsetHours = 7): string {
  const time = fmtTime(e.date, tzOffsetHours);
  const cc = COUNTRY_EMOJI[e.country.toUpperCase()] ?? e.country;
  const imp = IMPACT_EMOJI[e.impact] ?? "";
  const fc = e.forecast ? `\n📈 Forecast: ${e.forecast}` : "";
  const pv = e.previous ? `\n📊 Previous: ${e.previous}` : "";
  return `⚠️ NEWS ALERT (15 min)\n${imp} ${cc} ${e.title}\n⏰ ${time} (UTC+${tzOffsetHours})${fc}${pv}\n\n🔕 ระวังการเทรดช่วงข่าวออก`;
}

export function formatActual(e: FFEvent, tzOffsetHours = 7): string {
  const time = fmtTime(e.date, tzOffsetHours);
  const cc = COUNTRY_EMOJI[e.country.toUpperCase()] ?? e.country;
  const imp = IMPACT_EMOJI[e.impact] ?? "";
  const fc = e.forecast ? `\n📈 Forecast: ${e.forecast}` : "";
  const pv = e.previous ? `\n📊 Previous: ${e.previous}` : "";
  return `🔔 NEWS RELEASED\n${imp} ${cc} ${e.title}\n⏰ ${time} (UTC+${tzOffsetHours})${fc}${pv}`;
}
