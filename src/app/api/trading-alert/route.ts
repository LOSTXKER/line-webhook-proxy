// ===================================================================
// Trading Alert Webhook — Fan-out to LINE + Discord
// ===================================================================
//
// Environment Variables:
//   LINE_CHANNEL_ACCESS_TOKEN  = (required) LINE Messaging API token
//   LINE_TRADING_GROUP_ID      = (required) Group ID ของกลุ่ม LINE
//                                (พิมพ์ "group id" ในกลุ่มเพื่อดู)
//   DISCORD_WEBHOOK_URL        = (optional) Discord Webhook URL
//                                ถ้าตั้งไว้ → fan-out ไป Discord ด้วย
//                                ถ้าไม่ตั้ง → ส่งเฉพาะ LINE
//
// TradingView Alert Webhook URL:
//   https://line-webhook-proxy-one.vercel.app/api/trading-alert
//
// Pine Script payload:
//   { "type": "NOT_CONFIRM" | "CONFIRMED",
//     "dir":  "BULL" | "BEAR",
//     "pair": "EURUSD",
//     "tf":   "5",
//     "price": "1.0850",
//     "time": "14:30" }
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import { broadcast } from "@/lib/notify";

type AlertType = "NOT_CONFIRM" | "CONFIRMED" | string;
type AlertDir = "BULL" | "BEAR" | string;

interface TradingAlert {
  type?: AlertType;
  dir?: AlertDir;
  pair?: string;
  tf?: string;
  price?: string;
  time?: string;
}

function formatAlert(data: TradingAlert): string {
  const type = (data.type || "CONFIRMED").toUpperCase();
  const dir = (data.dir || "").toUpperCase();
  const pair = data.pair || "?";
  const time = data.time || new Date().toISOString().slice(11, 16);

  const isConfirmed = type === "CONFIRMED";
  const isBull = dir === "BULL";

  const label = isConfirmed ? "(Confirmed)" : "(Not confirm)";
  const dotEmj = isBull ? "🟢" : "🔴";
  const cta = isConfirmed
    ? "✅ เตรียมหาจุดเข้า M15/M5"
    : "⏳ รอแท่งปิดยืนยัน";

  return `${label} ${pair} ⏰ ${time} ${dotEmj} ${cta}`;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  console.log("[trading-alert] Received:", raw);

  let data: TradingAlert;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { pair: raw };
  }

  const message = formatAlert(data);
  const result = await broadcast(message, "trading");

  console.log(
    "[trading-alert] LINE:",
    "skipped" in result.line ? "SKIPPED" : result.line.ok ? "OK" : `FAIL ${result.line.status}`,
    "| Discord:",
    "skipped" in result.discord ? "SKIPPED" : result.discord.ok ? "OK" : `FAIL ${result.discord.status}`,
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  const lineOk = !!(
    process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TRADING_GROUP_ID
  );
  const discordOk = !!process.env.DISCORD_WEBHOOK_URL;

  return NextResponse.json({
    status: "ok",
    endpoint: "trading-alert",
    targets: {
      line: lineOk ? "configured" : "missing",
      discord: discordOk ? "configured" : "skipped",
    },
  });
}
