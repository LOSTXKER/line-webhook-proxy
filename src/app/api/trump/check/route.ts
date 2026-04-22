// ===================================================================
// GET /api/trump/check
// Cron-friendly — ส่ง alert ทุกโพสต์ใหม่จาก Truth Social ของ Trump
//
// Stateless detection: ใช้ pubDate ภายใน window N นาทีย้อนหลัง
// ถ้า cron ยิงทุก 5 นาที + window=5 → coverage 100% โดยไม่ซ้ำ
//
// Query params:
//   ?windowMin=5     ขนาด window ย้อนหลัง (default: 5)
//   ?dry=1           preview ไม่ส่งจริง
//   ?skipRT=1        ข้าม retruth (default: ส่งทั้งหมด)
//   ?max=10          จำกัดจำนวนต่อรอบ (default: 10 — กัน burst spam)
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  fetchPosts,
  filterByTimeRange,
  formatPost,
  type TrumpPost,
} from "@/lib/trump-truth";
import { broadcast, type BroadcastResult } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const skipRT = url.searchParams.get("skipRT") === "1";
  const windowMin = parseInt(url.searchParams.get("windowMin") || "5", 10);
  const max = parseInt(url.searchParams.get("max") || "10", 10);

  const now = Date.now();
  const windowMs = windowMin * 60 * 1000;

  try {
    const all = await fetchPosts();
    let recent = filterByTimeRange(all, now - windowMs, now);
    if (skipRT) recent = recent.filter((p) => !p.isRetruth);

    // เก่า → ใหม่ (ส่งตามลำดับเวลา) แล้ว cap จำนวน
    recent.sort((a, b) => a.pubMs - b.pubMs);
    const truncated = recent.length > max;
    const toSend = truncated ? recent.slice(-max) : recent;

    const sent: Array<{
      id: string;
      pubDate: string;
      title: string;
      result?: BroadcastResult;
    }> = [];

    if (!dry) {
      for (const post of toSend) {
        const r = await broadcast(formatPost(post), "trump");
        sent.push({
          id: post.id,
          pubDate: post.pubDate,
          title: titleSnippet(post),
          result: r,
        });
      }
    } else {
      for (const post of toSend) {
        sent.push({
          id: post.id,
          pubDate: post.pubDate,
          title: titleSnippet(post),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      now: new Date(now).toISOString(),
      window: { startMs: now - windowMs, endMs: now, minutes: windowMin },
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
