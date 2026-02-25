import { NextRequest, NextResponse } from "next/server";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

const getTargets = (): string[] =>
  (process.env.LINE_TARGETS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

async function replyGroupId(replyToken: string, groupId: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: `📱 Group ID:\n${groupId}\n\nคัดลอก ID นี้ไปวางในหน้าตั้งค่าบนเว็บของระบบที่ต้องการเชื่อมต่อ`,
        },
      ],
    }),
  });
}

/**
 * POST /api/webhook
 * Receive LINE webhook events and forward to all configured targets
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature") || "";
  const targets = getTargets();

  if (targets.length === 0) {
    console.warn("[proxy] No LINE_TARGETS configured");
    return NextResponse.json({ error: "No targets configured" }, { status: 500 });
  }

  // Handle "group id" command centrally (before forwarding)
  try {
    const parsed = JSON.parse(body);
    for (const event of parsed.events || []) {
      if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.source?.groupId &&
        event.replyToken
      ) {
        const text = (event.message.text || "").toLowerCase().trim();
        if (text === "group id" || text === "groupid" || text === "group") {
          await replyGroupId(event.replyToken, event.source.groupId);
        }
      }
    }
  } catch {
    // parsing failed — continue forwarding anyway
  }

  // Forward to all targets simultaneously
  const results = await Promise.allSettled(
    targets.map(async (url) => {
      const start = Date.now();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": signature,
        },
        body,
      });
      return { url, status: res.status, duration: Date.now() - start };
    })
  );

  const summary = results.map((r, i) => {
    if (r.status === "fulfilled") {
      return { target: targets[i], status: r.value.status, duration: `${r.value.duration}ms` };
    }
    return { target: targets[i], error: (r.reason as Error).message };
  });

  console.log("[proxy] Forwarded to", targets.length, "targets:", JSON.stringify(summary));

  return NextResponse.json({ success: true, targets: summary });
}

/**
 * GET /api/webhook
 * Health check endpoint
 */
export async function GET() {
  const targets = getTargets();

  return NextResponse.json({
    status: "ok",
    message: "LINE Webhook Proxy is running",
    targets: targets.length,
  });
}
