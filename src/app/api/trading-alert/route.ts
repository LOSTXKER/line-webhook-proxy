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

type SendResult = { ok: true } | { ok: false; status: number; error: string };

function formatAlert(data: TradingAlert): string {
  const type = (data.type || "CONFIRMED").toUpperCase();
  const dir  = (data.dir  || "").toUpperCase();
  const pair = data.pair  || "?";
  const time = data.time  || new Date().toISOString().slice(11, 16);

  const isConfirmed = type === "CONFIRMED";
  const isBull      = dir  === "BULL";

  const label  = isConfirmed ? "(Confirmed)" : "(Not confirm)";
  const dotEmj = isBull ? "🟢" : "🔴";
  const cta    = isConfirmed
    ? "✅ เตรียมหาจุดเข้า M15/M5"
    : "⏳ รอแท่งปิดยืนยัน";

  return `${label} ${pair} ⏰ ${time} ${dotEmj}\n${cta}`;
}

async function sendLine(token: string, groupId: string, message: string): Promise<SendResult> {
  try {
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
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status, error: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendDiscord(webhookUrl: string, message: string): Promise<SendResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    if (res.ok || res.status === 204) return { ok: true };
    return { ok: false, status: res.status, error: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(request: NextRequest) {
  const token       = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId     = process.env.LINE_TRADING_GROUP_ID;
  const discordHook = process.env.DISCORD_WEBHOOK_URL;

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

  // Fan-out: ส่ง LINE และ Discord ขนานกัน — ฝั่งใดล้มไม่กระทบอีกฝั่ง
  const [lineRes, discordRes] = await Promise.all([
    sendLine(token, groupId, message),
    discordHook ? sendDiscord(discordHook, message) : Promise.resolve(null),
  ]);

  console.log("[trading-alert] LINE:", lineRes.ok ? "OK" : `FAIL ${lineRes.status} ${lineRes.error}`);
  if (discordRes) {
    console.log("[trading-alert] Discord:", discordRes.ok ? "OK" : `FAIL ${discordRes.status} ${discordRes.error}`);
  } else {
    console.log("[trading-alert] Discord: SKIPPED (no DISCORD_WEBHOOK_URL)");
  }

  const overallOk = lineRes.ok && (!discordRes || discordRes.ok);
  return NextResponse.json(
    {
      ok: overallOk,
      line:    lineRes,
      discord: discordRes ?? { skipped: true },
    },
    { status: overallOk ? 200 : 500 },
  );
}

export async function GET() {
  const lineOk    = !!(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TRADING_GROUP_ID);
  const discordOk = !!process.env.DISCORD_WEBHOOK_URL;

  return NextResponse.json({
    status: "ok",
    endpoint: "trading-alert",
    targets: {
      line:    lineOk    ? "configured" : "missing",
      discord: discordOk ? "configured" : "skipped",
    },
  });
}
