# LINE Webhook Proxy

## Project
Multiplexer ที่รับ LINE webhook แล้ว forward ไปหลาย backend พร้อมกัน — single ingestion point

## Business
Infrastructure utility (ใช้กับ Anajak + Meelike)

## Stack
- Framework: Next.js 15 (API routes only)
- Cache: Upstash Redis
- Deploy: Vercel
- Parser: fast-xml-parser

## How to Run
```bash
npm install
# set LINE_TARGETS env var on Vercel
npm run dev    # localhost:3000
```

## Key Files
- `api/webhook.ts` — Main receiver + multiplexer
- GET `/api/webhook` — Health check

## Current Status
- ✅ Done — simple forwarding proxy, production ready
