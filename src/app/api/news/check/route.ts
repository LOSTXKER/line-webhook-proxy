// ===================================================================
// GET /api/news/check
// Cron-friendly endpoint — ตรวจหาข่าวสำคัญที่:
//   1) จะออกในอีก 10–15 นาที  → ส่ง pre-alert
//   2) เพิ่งออกใน 0–5 นาทีที่ผ่านมา  → ส่ง actual
//
// แนะนำให้ schedule ทุก 5 นาที: "*/5 * * * *"
// (Vercel Hobby tier จำกัด minute-granularity — ดู vercel.json)
//
// Stateless: ไม่บันทึกว่า event ไหนส่งแล้ว — ใช้ window-based detection
// ทำงานถูกต้องตราบที่ cron ยิงสม่ำเสมอ ไม่หลุด/ซ้อน
//
// Query params:
//   ?impact=High|Medium       (default: High)
//   ?ccy=USD,EUR              (filter ค่าเงิน — default: ทุกตัว)
//   ?dry=1                    (preview ไม่ส่งจริง)
//   ?windowMin=5              (ปรับขนาด window — default: 5 นาที)
//   ?leadMin=15               (pre-alert ล่วงหน้ากี่นาที — default: 15)
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  fetchWeek,
  filterByImpact,
  filterByCurrency,
  filterByTimeRange,
  formatPreAlert,
  formatActual,
  type Impact,
} from "@/lib/forex-factory";
import { broadcast, type BroadcastResult } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const impact = (url.searchParams.get("impact") as Impact) || "High";
  const ccyStr = url.searchParams.get("ccy") || "";
  const dry = url.searchParams.get("dry") === "1";
  const windowMin = parseInt(url.searchParams.get("windowMin") || "5", 10);
  const leadMin = parseInt(url.searchParams.get("leadMin") || "15", 10);
  const ccyList = ccyStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const now = Date.now();
  const windowMs = windowMin * 60 * 1000;
  const leadMs = leadMin * 60 * 1000;

  // pre-alert: events ที่จะเกิดในช่วง [now+lead-window, now+lead]
  // ตัวอย่าง lead=15, window=5: [now+10min, now+15min]
  const preStart = now + leadMs - windowMs;
  const preEnd = now + leadMs;

  // actual: events ที่เพิ่งเกิดในช่วง [now-window, now]
  const actStart = now - windowMs;
  const actEnd = now;

  try {
    const all = await fetchWeek();
    const filtered = filterByCurrency(filterByImpact(all, impact), ccyList);

    const preEvents = filterByTimeRange(filtered, preStart, preEnd);
    const actEvents = filterByTimeRange(filtered, actStart, actEnd);

    const sent: Array<{
      kind: "pre" | "actual";
      event: string;
      result?: BroadcastResult;
    }> = [];

    if (!dry) {
      for (const ev of preEvents) {
        const r = await broadcast(formatPreAlert(ev), "news");
        sent.push({ kind: "pre", event: `${ev.country} ${ev.title}`, result: r });
      }
      for (const ev of actEvents) {
        const r = await broadcast(formatActual(ev), "news");
        sent.push({ kind: "actual", event: `${ev.country} ${ev.title}`, result: r });
      }
    } else {
      preEvents.forEach((ev) =>
        sent.push({ kind: "pre", event: `${ev.country} ${ev.title}` }),
      );
      actEvents.forEach((ev) =>
        sent.push({ kind: "actual", event: `${ev.country} ${ev.title}` }),
      );
    }

    return NextResponse.json({
      ok: true,
      now: new Date(now).toISOString(),
      windows: {
        preAlert: {
          startMs: preStart,
          endMs: preEnd,
          count: preEvents.length,
        },
        actual: { startMs: actStart, endMs: actEnd, count: actEvents.length },
      },
      dry,
      sent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[news/check]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
