// ===================================================================
// GET /api/trump/check
// Cron-friendly — ส่ง alert ทุกโพสต์ใหม่จาก Truth Social ของ Trump
//
// Stateless detection: ใช้ pubDate ภายใน window N นาทีย้อนหลัง
// ถ้า cron ยิงทุก 5 นาที + window=5 → coverage 100% โดยไม่ซ้ำ
//
// Query params:
//   ?windowMin=5      ขนาด window ย้อนหลัง (default: 5)
//   ?dry=1            preview ไม่ส่งจริง
//   ?skipRT=1         ข้าม retruth (default: ส่งทั้งหมด)
//   ?max=10           จำกัดจำนวนต่อรอบ (default: 10)
//   ?translate=both   th-only / both / en (default: env TRUMP_TRANSLATE_MODE หรือ "both")
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
import { translate } from "@/lib/translate";

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
  const windowMin = parseInt(url.searchParams.get("windowMin") || "5", 10);
  const max = parseInt(url.searchParams.get("max") || "10", 10);
  const mode = normalizeMode(
    url.searchParams.get("translate") ?? process.env.TRUMP_TRANSLATE_MODE,
  );

  const now = Date.now();
  const windowMs = windowMin * 60 * 1000;

  try {
    const all = await fetchPosts();
    let recent = filterByTimeRange(all, now - windowMs, now);
    if (skipRT) recent = recent.filter((p) => !p.isRetruth);

    recent.sort((a, b) => a.pubMs - b.pubMs);
    const truncated = recent.length > max;
    const toSend = truncated ? recent.slice(-max) : recent;

    const sent: Array<{
      id: string;
      pubDate: string;
      title: string;
      translated?: boolean;
      result?: BroadcastResult;
    }> = [];

    for (const post of toSend) {
      // เตรียม english body (ตัดตามโหมด)
      const enCap = mode === "both" ? CAP_BOTH : CAP_SINGLE;
      const enBody = clip(post.text, enCap);

      // แปลถ้าจำเป็น
      let translated: string | undefined;
      if (mode !== "en" && enBody && enBody !== "[No text]") {
        const raw = await translate(enBody, "th");
        translated = clip(raw, mode === "both" ? CAP_BOTH : CAP_SINGLE);
      }

      const message = formatPost(
        { ...post, text: enBody },
        { translated, mode },
      );

      const result = dry
        ? undefined
        : await broadcast(message, "trump");

      sent.push({
        id: post.id,
        pubDate: post.pubDate,
        title: titleSnippet(post),
        translated: translated != null,
        ...(result ? { result } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      now: new Date(now).toISOString(),
      window: { startMs: now - windowMs, endMs: now, minutes: windowMin },
      mode,
      totalInFeed: all.length,
      matchedInWindow: recent.length,
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
