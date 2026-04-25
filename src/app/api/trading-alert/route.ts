// ===================================================================
// Trading Alert Webhook — Fan-out to LINE + Discord
// ===================================================================
//
// Environment Variables → ดูที่ lib/notify.ts
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
//     "time": "14:30",
//     "channel": "trading" | "trump" | "news" }
//
// channel routes to the matching Discord/LINE webhook (see notify.ts)
// ===================================================================

import { NextRequest, NextResponse } from "next/server";
import { broadcast, type Channel } from "@/lib/notify";

type AlertType = "NOT_CONFIRM" | "CONFIRMED" | string;
type AlertDir = "BULL" | "BEAR" | string;

interface TradingAlert {
  type?: AlertType;
  dir?: AlertDir;
  pair?: string;
  tf?: string;
  price?: string;
  time?: string;
  channel?: Channel;
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
  const channel: Channel = data.channel ?? "trading";
  const result = await broadcast(message, channel);

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
  const check = (key: string) => (process.env[key] ? "configured" : "missing");

  return NextResponse.json({
    status: "ok",
    endpoint: "trading-alert",
    targets: {
      line: lineOk ? "configured" : "missing",
      discord: check("DISCORD_WEBHOOK_URL"),
      discord_trump: check("DISCORD_TRUMP_WEBHOOK_URL"),
      discord_news: check("DISCORD_NEWS_WEBHOOK_URL"),
    },
  });
}
