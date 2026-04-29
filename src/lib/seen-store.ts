// ===================================================================
// seen-store.ts — Track sent post IDs to prevent duplicate broadcasts
// ===================================================================
// ใช้ Vercel KV (Upstash Redis) เก็บ ID ของโพสต์ที่ส่งแล้ว
// ถ้า KV ไม่ได้ตั้ง (KV_REST_API_URL/TOKEN ไม่มี) → fallback no-op
// ทำให้ระบบยังทำงานได้ปกติ (แต่จะไม่ dedupe)
//
// Key pattern: "seen:<namespace>:<id>"
// TTL default: 7 วัน — ปกติ feed ไม่ย้อนหลังเกิน
// ===================================================================

import { Redis } from "@upstash/redis";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

let _redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn("[seen-store] KV not configured — dedup disabled");
    _redis = null;
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

function key(namespace: string, id: string): string {
  return `seen:${namespace}:${id}`;
}

/**
 * Filter ids: return only ids that have NOT been seen yet.
 * If KV is unavailable, returns all ids (no-op fallback).
 */
export async function filterUnseen(
  namespace: string,
  ids: string[],
): Promise<string[]> {
  const redis = getRedis();
  if (!redis || ids.length === 0) return ids;
  try {
    const keys = ids.map((id) => key(namespace, id));
    const exists = await redis.mget<(string | null)[]>(...keys);
    return ids.filter((_, i) => !exists[i]);
  } catch (e) {
    console.error("[seen-store] mget failed:", e);
    return ids;
  }
}

/**
 * Mark ids as seen with TTL (default 7 days).
 * No-op if KV unavailable.
 */
export async function markSeen(
  namespace: string,
  ids: string[],
  ttlSec: number = TTL_SECONDS,
): Promise<void> {
  const redis = getRedis();
  if (!redis || ids.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.set(key(namespace, id), "1", { ex: ttlSec });
    }
    await pipeline.exec();
  } catch (e) {
    console.error("[seen-store] mark failed:", e);
  }
}

export function isKvConfigured(): boolean {
  return getRedis() !== null;
}
