// ===================================================================
// trump-truth.ts — Fetch + parse Trump Truth Social posts (via mirror)
// ===================================================================
// Source : https://trumpstruth.org/feed  (3rd-party real-time mirror)
//          truthsocial.com block IP server โดยตรง — ใช้ mirror แทน
//
// Item shape (RSS 2.0 + custom truth: namespace):
//   <title>          ข้อความสั้น (อาจขึ้นต้น "RT @user" สำหรับ retruth)
//   <description>    HTML เต็มของโพสต์
//   <link>           URL บน trumpstruth.org
//   <pubDate>        RFC 2822 format
//   <truth:originalUrl>  URL จริงบน truthsocial.com
//   <truth:originalId>   numeric ID ของ status (ใช้ dedupe ได้)
// ===================================================================

import { XMLParser } from "fast-xml-parser";

const TRUMP_FEED_URL = "https://trumpstruth.org/feed";

// LINE limit ~5000 chars/msg, Discord 2000 chars/content
// → cap ที่ 1500 chars + ellipsis เพื่อ safe ทั้งคู่
const MAX_CONTENT_LEN = 1500;

export interface TrumpPost {
  id: string;
  title: string;
  text: string;
  link: string;
  originalUrl: string;
  pubDate: string;
  pubMs: number;
  isRetruth: boolean;
}

interface RawItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  "truth:originalUrl"?: string;
  "truth:originalId"?: string | number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  cdataPropName: false,
  trimValues: true,
});

// ------------------- HTML helpers -------------------

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&lsquo;": "‘",
  "&rsquo;": "’",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&[a-zA-Z]+;/g, (m) => HTML_ENTITIES[m] ?? m);
}

function stripHtml(html: string): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function clip(s: string, max: number = MAX_CONTENT_LEN): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// ------------------- Fetch + parse -------------------

export async function fetchPosts(): Promise<TrumpPost[]> {
  const res = await fetch(TRUMP_FEED_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (line-webhook-proxy)" },
    // cache 60s ที่ Next.js layer — กันโหลด mirror หนักไป
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Trump RSS HTTP ${res.status}`);

  const xml = await res.text();
  const data = xmlParser.parse(xml);
  const channel = data?.rss?.channel;
  const rawItems: RawItem[] = !channel?.item
    ? []
    : Array.isArray(channel.item)
      ? channel.item
      : [channel.item];

  return rawItems
    .map((it) => normalize(it))
    .filter((p): p is TrumpPost => p !== null);
}

function normalize(it: RawItem): TrumpPost | null {
  const pubDate = (it.pubDate || "").toString();
  const pubMs = pubDate ? new Date(pubDate).getTime() : NaN;
  if (!Number.isFinite(pubMs)) return null;

  const id = String(it["truth:originalId"] ?? it.guid ?? "");
  const originalUrl = (it["truth:originalUrl"] || it.link || "").toString();
  const link = (it.link || originalUrl).toString();

  const titleRaw = (it.title || "").toString();
  const text = clip(stripHtml((it.description || "").toString())) || titleRaw;
  const isRetruth = /^\s*RT\s/.test(titleRaw) || /^\s*RT[: ]/.test(text);

  return {
    id,
    title: titleRaw,
    text,
    link,
    originalUrl,
    pubDate,
    pubMs,
    isRetruth,
  };
}

// ------------------- Filters -------------------

export function filterByTimeRange(
  posts: TrumpPost[],
  startMs: number,
  endMs: number,
): TrumpPost[] {
  return posts.filter((p) => p.pubMs >= startMs && p.pubMs < endMs);
}

// ------------------- Format -------------------

function fmtTime(ms: number, tzOffsetHours = 7): string {
  const d = new Date(ms + tzOffsetHours * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${hh}:${mm} (UTC+${tzOffsetHours}) | ${dd}/${mo}/${yy}`;
}

export type DisplayMode = "en" | "th" | "both";

export interface FormatOptions {
  /** ข้อความแปลภาษาไทย (จะใช้เมื่อ mode = "th" หรือ "both") */
  translated?: string;
  /** โหมดการแสดงผล (default: "en") */
  mode?: DisplayMode;
  /** offset timezone (default: 7 = UTC+7) */
  tzOffsetHours?: number;
}

export function formatPost(p: TrumpPost, opts: FormatOptions = {}): string {
  const { translated, mode = "en", tzOffsetHours = 7 } = opts;
  const head = p.isRetruth ? "🇺🇸 TRUMP TRUTH 🔁 (re-truth)" : "🇺🇸 TRUMP TRUTH 🆕";
  const time = fmtTime(p.pubMs, tzOffsetHours);
  const en = p.text || "[No text]";

  let body: string;
  if (mode === "th" && translated) {
    body = `🇹🇭 ${translated}`;
  } else if (mode === "both" && translated) {
    body = `🇹🇭 ${translated}\n\n🇬🇧 ${en}`;
  } else {
    body = `"${en}"`;
  }

  return `${head}\n${body}\n\n🕘 ${time}\n🔗 ${p.originalUrl}`;
}
