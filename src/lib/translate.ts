// ===================================================================
// translate.ts — Translation with provider fallback
// ===================================================================
// Provider chain:
//   1. Gemini API (ถ้ามี GEMINI_API_KEY)        — คุณภาพสูง รักษา tone/context
//   2. Google Translate free public endpoint    — fallback ถ้า Gemini ล้ม/ไม่มี key
//
// ENV (optional):
//   GEMINI_API_KEY    — สมัครฟรีที่ https://aistudio.google.com/apikey
//   GEMINI_MODEL      — default "gemini-2.0-flash" (เร็ว + ฟรี + คุณภาพดี)
//                       อื่นๆ: "gemini-2.5-flash", "gemini-1.5-flash"
// ===================================================================

const TIMEOUT_MS = 15_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

// ------------------- Provider 1: Gemini -------------------

const GEMINI_SYSTEM_INSTRUCTION = `You are a professional Thai translator specializing in social media posts and political news.

Rules:
- Translate the user's text into natural, fluent Thai (ภาษาไทยที่อ่านลื่น)
- Preserve emojis, hashtags (#word), mentions (@user), URLs, and numbers
- Keep proper nouns (people, places, organizations) — transliterate only when natural
- Match the tone (casual / formal / aggressive / sarcastic) of the original
- Output ONLY the Thai translation — no quotes, no explanations, no original text, no labels`;

async function translateGemini(
  text: string,
  apiKey: string,
): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }],
        },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        // ไม่บล็อกการเมือง/ข่าว (โพสต์ Trump มักโดน safety filter)
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[gemini] HTTP", res.status, body.slice(0, 200));
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (data?.promptFeedback?.blockReason) {
      console.warn("[gemini] blocked:", data.promptFeedback.blockReason);
      return null;
    }

    const parts = data?.candidates?.[0]?.content?.parts;
    const out = Array.isArray(parts)
      ? parts.map((p) => p?.text || "").join("").trim()
      : "";
    return out || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[gemini] fail:", msg);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------- Provider 2: Google Translate (free) -------------------

const GTX_URL = "https://translate.googleapis.com/translate_a/single";

interface GTXSegment extends Array<unknown> {
  0: string;
  1: string;
}
type GTXResponse = [GTXSegment[], ...unknown[]];

async function translateGoogle(
  text: string,
  targetLang: string,
  sourceLang = "auto",
): Promise<string> {
  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceLang,
    tl: targetLang,
    dt: "t",
  });
  const body = new URLSearchParams({ q: text });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const res = await fetch(`${GTX_URL}?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: body.toString(),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[gtx] HTTP", res.status);
      return text;
    }
    const data = (await res.json()) as GTXResponse | null;
    const segs = data?.[0];
    if (!Array.isArray(segs)) return text;
    return (
      segs
        .map((s) => (Array.isArray(s) ? String(s[0] ?? "") : ""))
        .join("")
        .trim() || text
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[gtx] fail:", msg);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------- Public API -------------------

export interface TranslateOptions {
  /** override env model (optional) */
  model?: string;
  /** force a specific provider — default: auto (gemini → gtx) */
  provider?: "auto" | "gemini" | "gtx";
}

export async function translate(
  text: string,
  targetLang = "th",
  opts: TranslateOptions = {},
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const provider = opts.provider ?? "auto";
  const geminiKey = process.env.GEMINI_API_KEY;

  // Gemini path (currently only configured for Thai output)
  if ((provider === "auto" || provider === "gemini") && geminiKey && targetLang === "th") {
    const result = await translateGemini(trimmed, geminiKey);
    if (result) return result;
    if (provider === "gemini") return text; // explicit gemini → no fallback
    // auto → fall through to gtx
  }

  return translateGoogle(trimmed, targetLang);
}
