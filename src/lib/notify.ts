// ===================================================================
// notify.ts — Unified notification helpers (LINE + Discord)
// ===================================================================
// ใช้ร่วมกันระหว่าง trading-alert และ news endpoints
//
// ENV (อ่านอัตโนมัติเมื่อใช้ broadcast()):
//   LINE_CHANNEL_ACCESS_TOKEN  — required ถ้าจะส่ง LINE
//   LINE_TRADING_GROUP_ID      — group สัญญาณเทรด (default ของทุก endpoint)
//   LINE_NEWS_GROUP_ID         — (optional) group สำหรับข่าว — fallback ไป trading
//   DISCORD_WEBHOOK_URL        — channel สัญญาณเทรด (default)
//   DISCORD_NEWS_WEBHOOK_URL   — (optional) channel สำหรับข่าว — fallback ไป default
// ===================================================================

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export type SendResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export type Channel = "trading" | "news";

export async function sendLine(
  token: string,
  groupId: string,
  message: string,
): Promise<SendResult> {
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
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendDiscord(
  webhookUrl: string,
  message: string,
): Promise<SendResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    if (res.ok || res.status === 204) return { ok: true };
    return { ok: false, status: res.status, error: await res.text() };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface BroadcastTargets {
  lineToken?: string | null;
  lineGroupId?: string | null;
  discordUrl?: string | null;
}

export interface BroadcastResult {
  ok: boolean;
  line: SendResult | { skipped: true };
  discord: SendResult | { skipped: true };
}

/**
 * Broadcast a message to LINE + Discord in parallel.
 * Channel="news" จะใช้ LINE_NEWS_GROUP_ID + DISCORD_NEWS_WEBHOOK_URL ก่อน,
 * fallback ไปตัว trading ถ้าไม่ตั้ง.
 */
export async function broadcast(
  message: string,
  channel: Channel = "trading",
  override: BroadcastTargets = {},
): Promise<BroadcastResult> {
  const lineToken =
    override.lineToken ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;

  const lineGroupId =
    override.lineGroupId ??
    (channel === "news"
      ? process.env.LINE_NEWS_GROUP_ID || process.env.LINE_TRADING_GROUP_ID
      : process.env.LINE_TRADING_GROUP_ID) ??
    null;

  const discordUrl =
    override.discordUrl ??
    (channel === "news"
      ? process.env.DISCORD_NEWS_WEBHOOK_URL ||
        process.env.DISCORD_WEBHOOK_URL
      : process.env.DISCORD_WEBHOOK_URL) ??
    null;

  const lineTask: Promise<SendResult | { skipped: true }> =
    lineToken && lineGroupId
      ? sendLine(lineToken, lineGroupId, message)
      : Promise.resolve({ skipped: true } as const);

  const discordTask: Promise<SendResult | { skipped: true }> = discordUrl
    ? sendDiscord(discordUrl, message)
    : Promise.resolve({ skipped: true } as const);

  const [line, discord] = await Promise.all([lineTask, discordTask]);

  const lineOk = "skipped" in line || line.ok;
  const discordOk = "skipped" in discord || discord.ok;

  return { ok: lineOk && discordOk, line, discord };
}
