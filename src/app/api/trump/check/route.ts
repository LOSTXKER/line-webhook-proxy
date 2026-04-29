// ===================================================================
// GET /api/trump/check
// Cron-friendly — ส่ง alert ทุกโพสต์ใหม่จาก Truth Social ของ Trump
//
// Stateful dedup: ใช้ Vercel KV เก็บ id ที่ส่งแล้ว (TTL 7 วัน)
//   → window กว้างได้โดยไม่ส่งซ้ำ → กัน mirror RSS delay
//   → ถ้า KV ไม่ได้ตั้ง: fallback no-dedup (เหมือน stateless เดิม)
//
// Query params:
//   ?windowMin=15     ขนาด window ย้อนหลัง (default: 15 — overlap กัน mirror delay)
//   ?dry=1            preview ไม่ส่งจริง
//   ?skipRT=1         ข้าม retruth (default: ส่งทั้งหมด)
//   ?max=10           จำกัดจำนวนต่อรอบ (default: 10)
//   ?translate=both   th-only / both / en (default: env TRUMP_TRANSLATE_MODE หรือ "both")
//   ?nodedup=1        ปิด dedup (เช่น manual replay)
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  fetchPosts,
  filterByTimeRange,
  formatPost,
  clip,
  type TrumpPost,
  type DisplayMode,
} from "@/lib/trump-truth";
import { broadcast, type BroadcastResult } from "@/lib/notify";
import { translateWithMeta, type Provider } from "@/lib/translate";
import { filterUnseen, markSeen, isKvConfigured } from "@/lib/seen-store";

const SEEN_NAMESPACE = "trump";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// cap ความยาวต่อภาษา ตามโหมด เพื่อกันข้อความเกิน Discord (2000) / LINE (5000)
const CAP_BOTH = 700; // ภาษาละ ~700 → รวม ~1500 + header/footer = ปลอดภัย
const CAP_SINGLE = 1500; // ภาษาเดียว → cap ปกติ

function normalizeMode(v: string | null | undefined): DisplayMode {
  const x = (v ?? "").trim().toLowerCase();
  if (["en", "0", "off", "no", "false"].includes(x)) return "en";
  if (["th", "thai", "1", "on", "yes", "true"].includes(x)) return "th";
  if (x === "both") return "both";
  return "both"; // default
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const skipRT = url.searchParams.get("skipRT") === "1";
  const windowMin = parseInt(url.searchParams.get("windowMin") || "15", 10);
  const max = parseInt(url.searchParams.get("max") || "10", 10);
  // dedup ผ่าน Vercel KV — กันส่งซ้ำเมื่อ window overlap
  // ตั้ง ?nodedup=1 เพื่อข้าม dedup (เช่น ตอน manual replay)
  const noDedup = url.searchParams.get("nodedup") === "1";
  const mode = normalizeMode(
    url.searchParams.get("translate") ?? process.env.TRUMP_TRANSLATE_MODE,
  );
  const providerParam = (url.searchParams.get("provider") || "auto").toLowerCase();
  const provider: Provider =
    providerParam === "gemini" || providerParam === "gtx"
      ? providerParam
      : "auto";

  const now = Date.now();
  const windowMs = windowMin * 60 * 1000;

  try {
    const all = await fetchPosts();
    let recent = filterByTimeRange(all, now - windowMs, now);
    if (skipRT) recent = recent.filter((p) => !p.isRetruth);

    recent.sort((a, b) => a.pubMs - b.pubMs);

    // dedup: กรองเอาเฉพาะ post id ที่ยังไม่เคยส่ง
    let toSend = recent;
    let skippedSeen = 0;
    if (!dry && !noDedup && recent.length > 0) {
      const ids = recent.map((p) => p.id).filter(Boolean);
      const unseenIds = new Set(await filterUnseen(SEEN_NAMESPACE, ids));
      const beforeCount = toSend.length;
      toSend = toSend.filter((p) => unseenIds.has(p.id));
      skippedSeen = beforeCount - toSend.length;
    }

    const truncated = toSend.length > max;
    toSend = truncated ? toSend.slice(-max) : toSend;

    const sent: Array<{
      id: string;
      pubDate: string;
      title: string;
      translated?: boolean;
      via?: string;
      preview?: string;
      result?: BroadcastResult;
    }> = [];

    const sentIds: string[] = [];
    for (const post of toSend) {
      const enCap = mode === "both" ? CAP_BOTH : CAP_SINGLE;
      const enBody = clip(post.text, enCap);

      let translated: string | undefined;
      let via: string | undefined;
      if (mode !== "en" && enBody && enBody !== "[No text]") {
        const r = await translateWithMeta(enBody, "th", { provider });
        translated = clip(r.text, mode === "both" ? CAP_BOTH : CAP_SINGLE);
        via = r.via;
      }

      const message = formatPost(
        { ...post, text: enBody },
        { translated, mode },
      );

      const result = dry ? undefined : await broadcast(message, "trump");

      // เก็บ id ที่ส่งแล้ว (เฉพาะที่ broadcast สำเร็จอย่างน้อย 1 ช่อง)
      const broadcastOk =
        !!result && (("ok" in result.discord && result.discord.ok) ||
                     ("ok" in result.line && result.line.ok));
      if (post.id && broadcastOk) sentIds.push(post.id);

      sent.push({
        id: post.id,
        pubDate: post.pubDate,
        title: titleSnippet(post),
        translated: translated != null,
        ...(via ? { via } : {}),
        ...(dry ? { preview: message } : {}),
        ...(result ? { result } : {}),
      });
    }

    if (sentIds.length > 0) await markSeen(SEEN_NAMESPACE, sentIds);

    return NextResponse.json({
      ok: true,
      now: new Date(now).toISOString(),
      window: { startMs: now - windowMs, endMs: now, minutes: windowMin },
      mode,
      provider,
      kvEnabled: isKvConfigured(),
      totalInFeed: all.length,
      matchedInWindow: recent.length,
      skippedSeen,
      truncated,
      dry,
      sent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[trump/check]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function titleSnippet(p: TrumpPost): string {
  const t = (p.text || p.title || "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 80) + "…" : t;
}
