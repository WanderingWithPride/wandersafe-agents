# Cloudflare Dashboard Configuration Guide

> **Completion Status:** Routes + Cron Triggers (final two deployment steps)

This guide walks through the manual Cloudflare Dashboard UI configuration required after agent deployment.

---

## Prerequisites

✅ All 5 agents deployed to `wandersafe-agents` Worker
✅ 5 of 8 secrets registered (missing: LEGISCAN_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET)
✅ D1 database configured and bound

**You will need:**
- Cloudflare account access (Michael's account)
- Domain: `wanderingwithpride.com`
- Admin password (ADMIN_PASSWORD secret value)

---

## Step A: Configure Routes

**Location:** Cloudflare Dashboard → Domains → wanderingwithpride.com → Workers & Pages → Routes

### Create Route 1: Legal/News/Event Monitors (Health Checks + Scheduled Runs)

| Field | Value |
|-------|-------|
| **Route** | `wanderingwithpride.com/api/wandersafe/*` |
| **Worker** | `wandersafe-agents` |
| **Zone** | wanderingwithpride.com |

**Explanation:** All `/api/wandersafe/*` requests route to the Worker. The Worker's `fetch()` handler uses the path to route to the correct health-check response. Scheduled runs use the cron trigger (configured in Step B).

### Create Route 2: Tally Webhook Receiver (Community Validator)

| Field | Value |
|-------|-------|
| **Route** | `wanderingwithpride.com/webhook/tally` |
| **Worker** | `wandersafe-agents` |
| **Zone** | wanderingwithpride.com |

**Explanation:** Tally.so sends form submissions to this webhook. The Worker's `fetch()` handler detects the `/webhook/tally` path and invokes the community-validator submission logic.

### Create Route 3: Admin Interface (Community Validator Dashboard)

| Field | Value |
|-------|-------|
| **Route** | `wanderingwithpride.com/wandersafe-admin/*` |
| **Worker** | `wandersafe-agents` |
| **Zone** | wanderingwithpride.com |

**Explanation:** Admin interface for reviewing and publishing community reports. Requires HTTP Basic Auth (admin username + ADMIN_PASSWORD).

---

## Step B: Configure Cron Triggers

**Location:** Cloudflare Dashboard → Domains → wanderingwithpride.com → Workers & Pages → wandersafe-agents → Triggers → Crons

The account supports **5 cron triggers maximum**. We use 3 (2 slots remain for future agents).

### Configure Cron Trigger 1: Legal Monitor (Mondays 6 AM UTC)

| Field | Value |
|-------|-------|
| **Cron Expression** | `0 6 * * 1` |
| **Description** | Legal monitor — polls Equaldex + State Dept RSS |

**When:** Mondays at 6:00 AM UTC
**Frequency:** Once per week
**Purpose:** Detect LGBTQ+ legal status changes in 10 tracked countries

### Configure Cron Trigger 2: News Monitor (Every Day 6 AM UTC)

| Field | Value |
|-------|-------|
| **Cron Expression** | `0 6 * * *` |
| **Description** | News monitor — searches Brave API for LGBTQ+ news |

**When:** Every day at 6:00 AM UTC
**Frequency:** Once per day
**Purpose:** Surface LGBTQ+-related news stories relevant to travel safety

### Configure Cron Trigger 3: Event Monitor (Tuesdays 6 AM UTC)

| Field | Value |
|-------|-------|
| **Cron Expression** | `0 6 * * 2` |
| **Description** | Event monitor — checks for local events by destination |

**When:** Tuesdays at 6:00 AM UTC
**Frequency:** Once per week
**Purpose:** Discover local LGBTQ+ events and Pride festivals by destination

---

## Step C: Verify Routes Are Live

After routes are created, test with curl:

```bash
# Test legal-monitor health check
curl -i https://wanderingwithpride.com/api/wandersafe/legal-monitor
# Expected: 200 OK + JSON: { "agent": "legal-monitor", "status": "ok", "tracked_countries": 10, ... }

# Test news-monitor health check
curl -i https://wanderingwithpride.com/api/wandersafe/news-monitor
# Expected: 200 OK + JSON: { "agent": "news-monitor", "status": "ok", ... }

# Test event-monitor health check
curl -i https://wanderingwithpride.com/api/wandersafe/event-monitor
# Expected: 200 OK + JSON: { "agent": "event-monitor", "status": "ok", ... }

# Test admin interface (requires auth)
curl -i -u admin:YOUR_ADMIN_PASSWORD https://wanderingwithpride.com/wandersafe-admin/queue
# Expected: 200 OK + HTML admin dashboard
```

---

## Step D: View Live Logs

After cron triggers fire, view logs in the CLI:

```bash
# Watch live logs (requires Node.js v20+)
source ~/.nvm/nvm.sh && nvm use 20
cd /tmp/wandersafe-agents
wrangler tail wandersafe-agents
```

Or view in Dashboard:
- Cloudflare Dashboard → Domains → wanderingwithpride.com → Workers & Pages → wandersafe-agents → Logs

---

## Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| 404 on `/api/wandersafe/*` | Route not created | Create route in Step A |
| Route created but returns 404 | Route points to wrong Worker | Verify route points to `wandersafe-agents` |
| Cron trigger not firing | Trigger not created | Create trigger in Step B (Dashboard only) |
| Agent responds but missing secrets | Missing API keys | Register remaining secrets (step requires user registration) |
| Admin login fails | Wrong password | Use value of ADMIN_PASSWORD secret |
| Logs not showing | Logs not enabled | Enable observability: already set in wrangler.toml |

---

## Next: Register Missing API Keys

Three API keys still need user registration and `wrangler secret put`:

```bash
source ~/.nvm/nvm.sh && nvm use 20
cd /tmp/wandersafe-agents

# 1. LegiScan (U.S. state bill tracking)
# First register at https://legiscan.com → get API key
wrangler secret put LEGISCAN_API_KEY

# 2. Reddit OAuth (social-intelligence agent)
# First register app at https://reddit.com/prefs/apps → create "script" app → get Client ID
wrangler secret put REDDIT_CLIENT_ID

# 3. Reddit OAuth Secret
# From same Reddit app registration → get Client Secret
wrangler secret put REDDIT_CLIENT_SECRET

# Verify all 8 registered:
wrangler secret list
```

---

## Final Verification Checklist

- [ ] Route 1 created (`/api/wandersafe/*`) → 200 responses
- [ ] Route 2 created (`/webhook/tally`) → accepts POST
- [ ] Route 3 created (`/wandersafe-admin/*`) → auth protected
- [ ] Cron trigger 1 set (`0 6 * * 1` — legal-monitor)
- [ ] Cron trigger 2 set (`0 6 * * *` — news-monitor)
- [ ] Cron trigger 3 set (`0 6 * * 2` — event-monitor)
- [ ] Routes return JSON responses (verified with curl)
- [ ] Admin auth works with ADMIN_PASSWORD
- [ ] Logs visible in Dashboard or via `wrangler tail`
- [ ] (Optional) LEGISCAN_API_KEY registered
- [ ] (Optional) REDDIT_CLIENT_ID registered
- [ ] (Optional) REDDIT_CLIENT_SECRET registered

✅ **Deployment Complete** — All agents live and routing correctly.

