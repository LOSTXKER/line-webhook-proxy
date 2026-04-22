// ===================================================================
// notify.ts — Unified notification helpers (LINE + Discord)
// ===================================================================
// ใช้ร่วมกันระหว่าง trading-alert และ news endpoints
//
// ENV (อ่านอัตโนมัติเมื่อใช้ broadcast()):
//   LINE_CHANNEL_ACCESS_TOKEN  — required ถ้าจะส่ง LINE
//   LINE_TRADING_GROUP_ID      — group สัญญาณเทรด (ใช้กับ channel "trading" เท่านั้น)
//   LINE_NEWS_GROUP_ID         — (optional) group สำหรับข่าว — ถ้าไม่ตั้งจะไม่ส่ง LINE
//   LINE_TRUMP_GROUP_ID        — (optional) group สำหรับ Trump truths — ถ้าไม่ตั้งจะไม่ส่ง LINE
//   ⚠️  news/trump จะไม่ fallback มาใช้ TRADING group โดยอัตโนมัติ
//       (เพื่อกัน spam เข้ากลุ่มสัญญาณเทรด)
//   DISCORD_WEBHOOK_URL        — channel สัญญาณเทรด (default)
//   DISCORD_NEWS_WEBHOOK_URL   — (optional) channel สำหรับข่าว — fallback ไป default
//   DISCORD_TRUMP_WEBHOOK_URL  — (optional) channel สำหรับ Trump truths — fallback news → default
// ===================================================================

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export type SendResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export type Channel = "trading" | "news" | "trump";

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

function resolveLineGroupId(channel: Channel): string | null {
  // news / trump ไม่ fallback มา TRADING group เพื่อกัน spam สัญญาณเทรด
  // ถ้าอยากให้ news/trump เข้า LINE ต้องตั้ง LINE_NEWS_GROUP_ID / LINE_TRUMP_GROUP_ID ชัดเจน
  switch (channel) {
    case "trump":
      return process.env.LINE_TRUMP_GROUP_ID || null;
    case "news":
      return process.env.LINE_NEWS_GROUP_ID || null;
    case "trading":
    default:
      return process.env.LINE_TRADING_GROUP_ID || null;
  }
}

function resolveDiscordUrl(channel: Channel): string | null {
  const trading = process.env.DISCORD_WEBHOOK_URL || null;
  const news = process.env.DISCORD_NEWS_WEBHOOK_URL || trading;
  switch (channel) {
    case "trump":
      return process.env.DISCORD_TRUMP_WEBHOOK_URL || news;
    case "news":
      return news;
    case "trading":
    default:
      return trading;
  }
}

/**
 * Broadcast a message to LINE + Discord in parallel.
 *
 * LINE routing (NO fallback):
 *   trading → LINE_TRADING_GROUP_ID (ถ้าไม่ตั้ง = skip LINE)
 *   news    → LINE_NEWS_GROUP_ID    (ถ้าไม่ตั้ง = skip LINE)
 *   trump   → LINE_TRUMP_GROUP_ID   (ถ้าไม่ตั้ง = skip LINE)
 *
 * Discord routing (with fallback chain):
 *   trading → DISCORD_WEBHOOK_URL
 *   news    → DISCORD_NEWS_WEBHOOK_URL  → DISCORD_WEBHOOK_URL
 *   trump   → DISCORD_TRUMP_WEBHOOK_URL → DISCORD_NEWS_WEBHOOK_URL → DISCORD_WEBHOOK_URL
 */
export async function broadcast(
  message: string,
  channel: Channel = "trading",
  override: BroadcastTargets = {},
): Promise<BroadcastResult> {
  const lineToken =
    override.lineToken ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;

  const lineGroupId = override.lineGroupId ?? resolveLineGroupId(channel);
  const discordUrl = override.discordUrl ?? resolveDiscordUrl(channel);

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
