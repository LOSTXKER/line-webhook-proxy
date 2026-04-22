// ===================================================================
// translate.ts — Free Google Translate (unofficial public endpoint)
// ===================================================================
// ไม่ต้องสมัคร API key ไม่มีบิล แต่ rate-limit ตาม IP
// ถ้า Google block → return original text (graceful fallback)
//
// Endpoint: POST https://translate.googleapis.com/translate_a/single
//   ?client=gtx&sl=auto&tl=th&dt=t   (body: q=...)
// ===================================================================

const GTX_URL = "https://translate.googleapis.com/translate_a/single";
const TIMEOUT_MS = 8000;

interface GTXSegment extends Array<unknown> {
  0: string; // translated
  1: string; // original
}
type GTXResponse = [GTXSegment[], ...unknown[]];

export async function translate(
  text: string,
  targetLang = "th",
  sourceLang = "auto",
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceLang,
    tl: targetLang,
    dt: "t",
  });
  const body = new URLSearchParams({ q: trimmed });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

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
      console.warn("[translate] HTTP", res.status);
      return text;
    }
    const data = (await res.json()) as GTXResponse | null;
    const segs = data?.[0];
    if (!Array.isArray(segs)) return text;
    const out = segs
      .map((s) => (Array.isArray(s) ? String(s[0] ?? "") : ""))
      .join("")
      .trim();
    return out || text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[translate] fail:", msg);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
