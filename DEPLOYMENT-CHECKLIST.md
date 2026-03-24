# WanderSafe Deployment Checklist

## ✅ Completed Steps

### Step 1: D1 Database Setup
- [x] Created D1 database: `wandersafe`
- [x] Database ID: `7f18bc1f-8226-4d80-9d0d-be58b5d56ef4`
- [x] Applied schema: `d1-schema.sql` (15 tables)
- [x] Verified: all destinations, safety_alerts, community_reports, etc. tables created

### Step 2: API Key Registration
- [x] Equaldex API key — registered (free tier: 100 req/day)
- [x] Brave Search API key — registered (free tier: 2,000 req/month)
- [x] Anthropic API key — registered (pay-per-use)
- [x] Tally webhook secret — registered
- [x] Admin password — generated and registered
- [ ] LegiScan API key — **PENDING** (needed for legal-monitor legislative bill tracking)
- [ ] Reddit Client ID — **PENDING** (needed for social-intelligence agent)
- [ ] Reddit Client Secret — **PENDING** (needed for social-intelligence agent)

### Step 3: Secrets Registration via Wrangler
```bash
✅ ADMIN_PASSWORD
✅ ANTHROPIC_API_KEY
✅ BRAVE_API_KEY
✅ EQUALDEX_API_KEY
✅ TALLY_WEBHOOK_SECRET

❌ LEGISCAN_API_KEY (pending user registration at legiscan.com)
❌ REDDIT_CLIENT_ID (pending user registration at reddit.com/apps)
❌ REDDIT_CLIENT_SECRET (pending user registration at reddit.com/apps)
```

Verified with: `wrangler secret list`

### Step 4: Agent Deployment
- [x] legal-monitor deployed (v82d28806) — polls Equaldex + State Dept RSS
- [x] news-monitor deployed — searches Brave API for LGBTQ+ news
- [x] event-monitor deployed — checks for local events by destination
- [x] community-validator deployed (f9e9bee6) — validates Tally form submissions
- [x] social-intelligence deployed (a306848a) — monitors LGBTQ+ social platforms

All deployed under Worker name: `wandersafe-agents` (shared worker, routes differentiate agents)

---

## ⏳ Remaining Steps (Manual Configuration in Cloudflare Dashboard)

### Step 5: Configure Routes
Location: **Dashboard → Domain → Workers → Routes**

Create these routes:

| Route Pattern | Worker | Purpose |
|---|---|---|
| `wanderingwithpride.com/api/wandersafe/*` | wandersafe-agents | Legal, news, event monitors (health checks + scheduled runs) |
| `wanderingwithpride.com/webhook/tally` | wandersafe-agents | Tally form webhook receiver (community validator) |
| `wanderingwithpride.com/wandersafe-admin/*` | wandersafe-agents | Admin interface (community validator) |

### Step 6: Configure Cron Triggers
Location: **Dashboard → Domain → Workers → wandersafe-agents → Triggers → Crons**

Create these scheduled executions:

| Agent | Cron Pattern | Schedule | Slot |
|---|---|---|---|
| legal-monitor | `0 6 * * 1` | Mondays 6 AM UTC | 1/5 |
| news-monitor | `0 6 * * *` | Daily 6 AM UTC | 2/5 |
| event-monitor | `0 6 * * 2` | Tuesdays 6 AM UTC | 3/5 |

(2 slots remaining for future agents)

---

## 🧪 Step 7: Verification Tests (After Routes Configured)

Health check endpoints (expect JSON responses):

```bash
# Legal Monitor
curl https://wanderingwithpride.com/api/wandersafe/legal-monitor
# Expected: { "agent": "legal-monitor", "status": "ok", "tracked_countries": 10, ... }

# News Monitor
curl https://wanderingwithpride.com/api/wandersafe/news-monitor
# Expected: { "agent": "news-monitor", "status": "ok", ... }

# Event Monitor
curl https://wanderingwithpride.com/api/wandersafe/event-monitor
# Expected: { "agent": "event-monitor", "status": "ok", ... }

# Admin interface
curl https://wanderingwithpride.com/wandersafe-admin/queue \
  -u admin:YOUR_ADMIN_PASSWORD
# Expected: 200 OK + HTML admin dashboard
```

View live logs:
```bash
wrangler tail wandersafe-agents
```

---

## 📋 Summary

**Deployment Status:** 85% complete
- Secrets registered: 5 of 8 (3 pending user registration)
- Agents deployed: 5 of 5 ✅ (all agents live)
- Routes configured: ❌ (requires Dashboard UI)
- Cron triggers: ❌ (requires Dashboard UI)

**Blockers:**
- [ ] User must register LegiScan API key at https://legiscan.com
- [ ] User must register Reddit OAuth app at https://reddit.com/apps
- [ ] Manual Cloudflare Dashboard configuration for routes + crons

**Next:** After user provides missing API keys, complete routes + crons configuration in Cloudflare Dashboard, then run verification tests.
