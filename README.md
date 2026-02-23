# LINE Webhook Proxy

Forward LINE webhook events to multiple systems simultaneously.

## Setup

### 1. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

### 2. Set environment variable on Vercel

Go to Vercel Dashboard → Settings → Environment Variables:

```
LINE_TARGETS=https://system-a.com/api/line/webhook,https://system-b.com/api/line/webhook
```

### 3. Update LINE Developer Console

Change Webhook URL to your proxy URL:

```
https://your-proxy.vercel.app/api/webhook
```

### 4. Done

All configured systems will receive LINE events simultaneously.

## Health Check

```
GET https://your-proxy.vercel.app/api/webhook
```

## Logs

View forwarding logs in Vercel Dashboard → Deployments → Function Logs.
