# WanderSafe Dashboard Configuration — Quick Start

**Status:** All 5 agents deployed ✅
**Next:** Create routes + cron triggers in Cloudflare Dashboard
**Time:** ~10 minutes

---

## 1️⃣ Create Routes

**Go to:** Cloudflare Dashboard → wanderingwithpride.com → Workers & Pages → Routes

Click **Create route** three times:

### Route 1
```
Pattern: wanderingwithpride.com/api/wandersafe/*
Worker:  wandersafe-agents
Zone:    wanderingwithpride.com
```

### Route 2
```
Pattern: wanderingwithpride.com/webhook/tally
Worker:  wandersafe-agents
Zone:    wanderingwithpride.com
```

### Route 3
```
Pattern: wanderingwithpride.com/wandersafe-admin/*
Worker:  wandersafe-agents
Zone:    wanderingwithpride.com
```

---

## 2️⃣ Create Cron Triggers

**Go to:** Cloudflare Dashboard → wanderingwithpride.com → Workers & Pages → wandersafe-agents → Triggers → Crons

Click **Create trigger** three times:

### Trigger 1: Legal Monitor
```
Cron:        0 6 * * 1
Description: Legal monitor — Equaldex + State Dept RSS
```

### Trigger 2: News Monitor
```
Cron:        0 6 * * *
Description: News monitor — Brave API search
```

### Trigger 3: Event Monitor
```
Cron:        0 6 * * 2
Description: Event monitor — local LGBTQ+ events
```

---

## 3️⃣ Test Routes

After routes are created:

```bash
# Test legal-monitor
curl https://wanderingwithpride.com/api/wandersafe/legal-monitor
# Expected: JSON with { "agent": "legal-monitor", "status": "ok", ... }

# Test news-monitor
curl https://wanderingwithpride.com/api/wandersafe/news-monitor
# Expected: JSON with { "agent": "news-monitor", "status": "ok", ... }

# Test event-monitor
curl https://wanderingwithpride.com/api/wandersafe/event-monitor
# Expected: JSON with { "agent": "event-monitor", "status": "ok", ... }
```

---

## ✅ Done!

Once routes are live, agents will:
- Respond to health checks immediately
- Run on schedule at configured cron times
- Store alerts in D1 database
- Wait for admin approval before publishing

**Next step (optional):** Register 3 missing API keys for full functionality

**Details:** See `CLOUDFLARE-DASHBOARD-SETUP.md` for full walkthrough + troubleshooting

