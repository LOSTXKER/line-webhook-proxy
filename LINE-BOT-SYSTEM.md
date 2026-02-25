# Anajak BOT - LINE Bot System

## Overview

Anajak BOT เป็น LINE Bot กลางที่ใช้ร่วมกันข้ามหลายระบบ (Bill Tracker, Anajak HR, ฯลฯ) โดยมี Webhook Proxy เป็นตัวกลางรับ event จาก LINE แล้วกระจายไปแต่ละระบบ

---

## Architecture

```
LINE Platform
     │
     │  POST /api/webhook (ทุก event)
     ▼
┌─────────────────────────────────────────┐
│  Webhook Proxy (line-webhook-proxy)     │
│  line-webhook-proxy-one.vercel.app      │
│                                         │
│  - รับ event จาก LINE                   │
│  - ตอบคำสั่ง "group id" (คำสั่งกลาง)   │
│  - Forward event ไปทุกระบบพร้อมกัน      │
└────────┬───────────────┬────────────────┘
         │               │
         ▼               ▼
┌────────────────┐ ┌────────────────┐
│  Bill Tracker  │ │  Anajak HR     │
│  (ระบบบัญชี)   │ │  (ระบบ HR)     │
│                │ │                │
│  ตอบเฉพาะ     │ │  ตอบเฉพาะ     │
│  กลุ่มที่ตั้ง   │ │  กลุ่มที่ตั้ง   │
│  ค่าไว้เท่านั้น │ │  ค่าไว้เท่านั้น │
└────────────────┘ └────────────────┘
```

---

## Components

### 1. LINE Bot (Anajak BOT)

- สร้างบน LINE Developer Console (Messaging API)
- มี Channel Secret และ Channel Access Token
- Webhook URL ชี้ไปที่ **Proxy** (ไม่ใช่ระบบใดระบบหนึ่ง)

### 2. Webhook Proxy (`line-webhook-proxy`)

- **Repo**: https://github.com/LOSTXKER/line-webhook-proxy
- **URL**: https://line-webhook-proxy-one.vercel.app
- **Endpoint**: `POST /api/webhook`
- **หน้าที่**:
  - รับ event จาก LINE Platform
  - ตอบคำสั่งกลาง (`group id`) ทุกกลุ่ม
  - Forward event (พร้อม `x-line-signature`) ไปทุกระบบที่ตั้งค่าไว้

### 3. Target Systems (Bill Tracker, Anajak HR, ฯลฯ)

แต่ละระบบ:
- มี webhook endpoint ของตัวเอง (เช่น `/api/line/webhook`)
- Verify signature ด้วย Channel Secret เดียวกัน
- ตอบ **เฉพาะกลุ่มที่ตั้งค่า Group ID ไว้** เท่านั้น
- Ignore event จากกลุ่มอื่น

---

## Event Flow

### ผู้ใช้พิมพ์ข้อความในกลุ่ม LINE

```
1. ผู้ใช้พิมพ์ข้อความในกลุ่ม
2. LINE ส่ง POST ไปที่ Proxy
3. Proxy ตรวจสอบว่าเป็นคำสั่ง "group id" หรือไม่
   - ถ้าใช่ → Proxy ตอบ Group ID ทันที
   - ถ้าไม่ → ข้ามไป
4. Proxy forward event ไปทุกระบบพร้อมกัน
5. แต่ละระบบตรวจสอบ:
   - Verify signature (Channel Secret ตรงไหม?)
   - ตรวจ groupId ว่าตรงกับบริษัทที่ตั้งค่าไว้ไหม?
   - ถ้าตรง → ประมวลผล (ตอบข้อความ, วิเคราะห์รูป, ฯลฯ)
   - ถ้าไม่ตรง → ignore
```

### บอทเข้ากลุ่มใหม่

```
1. เพิ่ม Anajak BOT เข้ากลุ่ม LINE
2. LINE ส่ง join event ไปที่ Proxy
3. Proxy forward ไปทุกระบบ
4. แต่ละระบบตรวจ groupId:
   - ถ้ามีบริษัทตั้งค่า groupId ตรง → ส่งข้อความต้อนรับ
   - ถ้าไม่มี → ignore (ไม่ตอบ)
5. ถ้าต้องการเชื่อมต่อกับระบบ:
   - พิมพ์ "group id" → Proxy ตอบ Group ID
   - คัดลอก Group ID ไปวางในหน้าตั้งค่าของระบบนั้น
```

---

## Environment Variables

### Proxy (line-webhook-proxy)

| Variable | Description | Example |
|---|---|---|
| `LINE_TARGETS` | URL ของระบบที่ต้องการ forward (คั่นด้วย comma) | `https://bill-tracker.vercel.app/api/line/webhook,https://anajak-hr.vercel.app/api/line/webhook` |
| `LINE_CHANNEL_ACCESS_TOKEN` | Access Token ของ Anajak BOT (สำหรับตอบคำสั่ง group id) | `xxxx...` |

### Target System (เช่น Bill Tracker)

ตั้งค่าผ่านหน้าเว็บของแต่ละระบบ (ไม่ใช่ env var):
- **Channel Secret** — สำหรับ verify signature
- **Channel Access Token** — สำหรับตอบข้อความ
- **Group ID** — ระบุว่ากลุ่มไหนเป็นของบริษัทนี้

---

## การเพิ่มระบบใหม่

1. สร้าง webhook endpoint ในระบบใหม่ (รับ POST, verify signature, ประมวลผล event)
2. ระบบใหม่ต้อง **ตอบเฉพาะกลุ่มที่ตั้งค่า Group ID ไว้** (ไม่งั้นจะชนกับระบบอื่น)
3. เพิ่ม URL ของระบบใหม่ใน `LINE_TARGETS` บน Vercel ของ Proxy
4. Redeploy Proxy

---

## การเพิ่มกลุ่ม LINE ใหม่

1. เพิ่ม Anajak BOT เข้ากลุ่ม LINE
2. พิมพ์ `group id` ในกลุ่ม → Proxy จะตอบ Group ID
3. คัดลอก Group ID
4. ไปหน้าตั้งค่าของระบบที่ต้องการ → วาง Group ID → บันทึก
5. ระบบนั้นจะเริ่มตอบข้อความในกลุ่มนี้

---

## ข้อจำกัด

### Reply Token

- LINE ให้ Reply Token มา 1 อัน ต่อ 1 event
- ใช้ได้ **ครั้งเดียว** ภายใน **30 วินาที**
- ถ้า Proxy ใช้ reply (เช่น ตอบ "group id") → ระบบปลายทางจะ reply ไม่ได้
- ระบบปลายทางสามารถใช้ **Push Message** แทน (มี quota ตาม plan)

### Shared Bot

- ทุกระบบใช้ Channel Secret / Access Token เดียวกัน
- แต่ละระบบต้องกรองด้วย Group ID เพื่อไม่ให้ตอบซ้ำกัน
- หนึ่งกลุ่ม LINE ควรผูกกับ **ระบบเดียว** เท่านั้น

---

## Quick Reference

| Item | Value |
|---|---|
| Bot Name | Anajak BOT |
| Proxy URL | https://line-webhook-proxy-one.vercel.app |
| Proxy Webhook | `POST /api/webhook` |
| Proxy Health Check | `GET /api/webhook` |
| Proxy Repo | https://github.com/LOSTXKER/line-webhook-proxy |
| LINE Developer Console | https://developers.line.biz/console/ |

---

## Troubleshooting

| ปัญหา | สาเหตุ | แก้ไข |
|---|---|---|
| บอทไม่ตอบในกลุ่ม | Group ID ไม่ได้ตั้งค่าในระบบ | พิมพ์ "group id" → คัดลอก → วางในหน้าตั้งค่า |
| บอทตอบซ้ำ 2 ข้อความ | 2 ระบบตั้ง Group ID เดียวกัน | ตรวจสอบว่าแต่ละกลุ่มผูกกับระบบเดียว |
| "group id" ไม่ตอบ | Proxy ไม่มี `LINE_CHANNEL_ACCESS_TOKEN` | เพิ่ม env var บน Vercel ของ Proxy |
| ระบบใหม่ไม่ได้รับ event | ยังไม่เพิ่ม URL ใน `LINE_TARGETS` | เพิ่ม URL แล้ว Redeploy Proxy |
| Verify webhook failed | Webhook URL ผิด | ต้องเป็น `https://.../api/webhook` (ไม่ใช่ root URL) |
