// ===================================================================
// ไฟล์นี้ให้คัดลอกไปวางที่:
// line-webhook-proxy/src/app/api/trading-alert/route.ts
// ===================================================================
//
// Environment Variables ที่ต้องเพิ่มบน Vercel:
//   LINE_TRADING_GROUP_ID  = Group ID ของกลุ่ม LINE ที่จะส่งแจ้งเตือน
//                            (พิมพ์ "group id" ในกลุ่มเพื่อดู)
//
// ใช้ LINE_CHANNEL_ACCESS_TOKEN ที่มีอยู่แล้ว
//
// TradingView Alert Webhook URL:
//   https://line-webhook-proxy-one.vercel.app/api/trading-alert
//
// Pine Script ส่ง payload แบบนี้:
//   { "type": "NOT_CONFIRM" | "CONFIRMED",
//     "dir":  "BULL" | "BEAR",
//     "pair": "EURUSD",
//     "tf":   "5",
//     "price": "1.0850",
//     "time": "14:30" }
// ===================================================================

import { NextRequest, NextResponse } from "next/server";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

type AlertType = "NOT_CONFIRM" | "CONFIRMED" | string;
type AlertDir  = "BULL" | "BEAR" | string;

interface TradingAlert {
  type?: AlertType;
  dir?:  AlertDir;
  pair?: string;
  tf?:   string;
  price?: string;
  time?: string;
}

function tfLabel(tf?: string): string {
  if (!tf) return "M5";
  switch (tf) {
    case "1":   return "M1";
    case "3":   return "M3";
    case "5":   return "M5";
    case "15":  return "M15";
    case "30":  return "M30";
    case "60":  return "H1";
    case "240": return "H4";
    case "D":
    case "1D":  return "D1";
    case "W":
    case "1W":  return "W1";
    default:    return tf;
  }
}

function formatAlert(data: TradingAlert): string {
  const type  = (data.type || "CONFIRMED").toUpperCase();
  const dir   = (data.dir  || "").toUpperCase();
  const pair  = data.pair  || "?";
  const price = data.price || "?";
  const tf    = tfLabel(data.tf);
  const time  = data.time  || new Date().toISOString().slice(11, 16);

  const isConfirmed = type === "CONFIRMED";
  const isBull      = dir  === "BULL";

  const header = isConfirmed
    ? (isBull ? "🟢 BUY CONFIRMED" : "🔴 SELL CONFIRMED")
    : (isBull ? "🟡 Buy Setup (Not Confirmed)" : "🟠 Sell Setup (Not Confirmed)");

  const arrow = isBull ? "▲ Bull Pullback" : "▼ Bear Pullback";
  const tail  = isConfirmed
    ? "✅ แท่งปิดแล้ว — พิจารณาเข้า"
    : "⏳ รอแท่งปิดยืนยันก่อนเข้า";

  return [
    header,
    "━━━━━━━━━━━━━━━━━━",
    `📊 ${pair}`,
    `📍 ${arrow}`,
    `💰 Price: ${price}`,
    `⏰ TF: ${tf}`,
    `🕐 ${time}`,
    "━━━━━━━━━━━━━━━━━━",
    tail,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const token   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_TRADING_GROUP_ID;

  if (!token || !groupId) {
    console.error("[trading-alert] Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_TRADING_GROUP_ID");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const raw = await request.text();
  console.log("[trading-alert] Received:", raw);

  let data: TradingAlert;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { pair: raw };
  }

  const message = formatAlert(data);

  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text: message }],
    }),
  });

  if (res.ok) {
    console.log("[trading-alert] LINE push OK");
    return NextResponse.json({ ok: true });
  }

  const err = await res.text();
  console.error("[trading-alert] LINE push failed:", res.status, err);
  return NextResponse.json({ ok: false, error: err }, { status: 500 });
}

export async function GET() {
  const configured = !!(
    process.env.LINE_CHANNEL_ACCESS_TOKEN &&
    process.env.LINE_TRADING_GROUP_ID
  );

  return NextResponse.json({
    status: "ok",
    endpoint: "trading-alert",
    configured,
  });
}
