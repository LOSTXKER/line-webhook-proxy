// ===================================================================
// GET /api/news/weekly
// ส่งสรุปข่าวสำคัญของสัปดาห์นี้ (group by day) ไป LINE+Discord
//
// Query params (optional):
//   ?impact=Low|Medium|High   (default: High)
//   ?ccy=USD,EUR,GBP          (filter เฉพาะค่าเงิน — default: ทุกตัว)
//   ?dry=1                    (preview เฉยๆ ไม่ส่งจริง)
//
// ใช้เป็น Vercel Cron วันจันทร์ 7:00 UTC+7 = 0:00 UTC วันจันทร์ → "0 0 * * 1"
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  fetchWeek,
  filterByImpact,
  filterByCurrency,
  formatWeekSummary,
  resolveCurrencyFilter,
  type Impact,
} from "@/lib/forex-factory";
import { broadcast } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const impact = (url.searchParams.get("impact") as Impact) || "High";
  const dry = url.searchParams.get("dry") === "1";
  const ccyList = resolveCurrencyFilter(url.searchParams.get("ccy"));

  try {
    const all = await fetchWeek();
    const filtered = filterByCurrency(filterByImpact(all, impact), ccyList);
    const message = formatWeekSummary(filtered);

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
    console.error("[news/weekly]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
