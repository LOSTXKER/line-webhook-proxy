import { NextRequest, NextResponse } from "next/server";

const getTargets = (): string[] =>
  (process.env.LINE_TARGETS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

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

  // Log results (visible in Vercel Function Logs)
  const summary = results.map((r, i) => {
    if (r.status === "fulfilled") {
      return { target: targets[i], status: r.value.status, duration: `${r.value.duration}ms` };
    }
    return { target: targets[i], error: (r.reason as Error).message };
  });

  console.log("[proxy] Forwarded LINE event to", targets.length, "targets:", JSON.stringify(summary));

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
