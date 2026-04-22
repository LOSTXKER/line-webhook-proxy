// ===================================================================
// GET /api/news/today
// ส่งข่าวสำคัญของวันนี้ (UTC+7) ไป LINE+Discord
//
// Query params (optional):
//   ?impact=Low|Medium|High   (default: Medium)
//   ?ccy=USD,EUR,GBP          (filter เฉพาะค่าเงิน — default: ทุกตัว)
//   ?dry=1                    (preview เฉยๆ ไม่ส่งจริง)
//
// ใช้เป็น Vercel Cron schedule รายวันได้ (เช่น 7:00 UTC+7 = 0:00 UTC)
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  fetchWeek,
  filterByDay,
  filterByImpact,
  filterByCurrency,
  formatDaySummary,
  resolveCurrencyFilter,
  type Impact,
} from "@/lib/forex-factory";
import { broadcast } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const impact = (url.searchParams.get("impact") as Impact) || "Medium";
  const dry = url.searchParams.get("dry") === "1";
  const ccyList = resolveCurrencyFilter(url.searchParams.get("ccy"));

  try {
    const all = await fetchWeek();
    const today = filterByDay(all);
    const filtered = filterByCurrency(filterByImpact(today, impact), ccyList);
    const message = formatDaySummary(filtered);

    if (dry) {
      return NextResponse.json({
        ok: true,
        dry: true,
        count: filtered.length,
        message,
      });
    }

    const result = await broadcast(message, "news");
    return NextResponse.json({
      count: filtered.length,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[news/today]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
