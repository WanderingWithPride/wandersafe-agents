# WanderSafe Agents Deployment Guide

This guide covers deploying the WanderSafe monitoring agents to Cloudflare Workers.

## Prerequisites

1. **Cloudflare Account** — Workers + D1 enabled
2. **Wrangler CLI** — install via `npm install -g wrangler` or use `npx wrangler`
3. **API Keys** — register for the following (detailed below)
4. **wrangler auth** — `wrangler login` to authenticate your Cloudflare account

## Step 1: Set Up the D1 Database

All agents share a single Cloudflare D1 SQLite database.

```bash
# Create the database
wrangler d1 create wandersafe

# Copy the Database ID from the output
# Update wrangler.toml: replace REPLACE_WITH_DB_ID with the actual ID

# Apply the schema
wrangler d1 execute wandersafe --file=schema/d1-schema.sql

# Verify the schema was applied
wrangler d1 execute wandersafe --command="SELECT name FROM sqlite_master WHERE type='table';"
```

## Step 2: Register API Keys

### Legal Monitor
- **Equaldex API**: Register at [equaldex.com/api](https://equaldex.com/api)
  - Free tier: 100 requests/day
  - Store the API key

- **LegiScan API**: Register at [legiscan.com](https://legiscan.com)
  - Free tier available (requires free account)
  - Store the API key

### News Monitor
- **Brave Search API**: Register at [api.search.brave.com](https://api.search.brave.com)
  - Free tier: 2,000 requests/month
  - Store the API key

### Community Validator
- **Anthropic API**: Create key at [console.anthropic.com](https://console.anthropic.com)
  - Pay-per-use (approx $5-10/month at low volume)
  - Store the API key

- **Tally Webhook Secret**: From your Tally form settings
  - Navigate to: Tally form → Settings → Webhooks → Create webhook
  - Set webhook URL to: `https://your-worker-domain.com/webhook/tally`
  - Copy the generated secret

- **Admin Password**: Generate a strong password for the admin interface
  - Example: `$(openssl rand -base64 32)`

### Social Intelligence
- **Reddit API**: Register at [reddit.com/apps](https://reddit.com/apps)
  - Create an OAuth application ("script" type)
  - Store the Client ID and Client Secret

## Step 3: Store Secrets in Cloudflare

```bash
# Set secrets (Cloudflare will prompt for values)
wrangler secret put EQUALDEX_API_KEY
wrangler secret put LEGISCAN_API_KEY
wrangler secret put BRAVE_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put TALLY_WEBHOOK_SECRET
wrangler secret put ADMIN_PASSWORD
wrangler secret put REDDIT_CLIENT_ID
wrangler secret put REDDIT_CLIENT_SECRET

# Verify secrets were stored (names only, not values)
wrangler secret list
```

## Step 4: Deploy Individual Agents

Each agent is deployed as its own Worker. Modify the `main` field in `wrangler.toml` before deploying each one.

### Deploy Legal Monitor
```bash
# Update wrangler.toml: set main = "agents/legal-monitor.js"
# Then deploy:
wrangler deploy
# Or use npx:
npx wrangler deploy --config wrangler.toml
```

### Deploy News Monitor
```bash
# Update wrangler.toml: set main = "agents/news-monitor.js"
wrangler deploy
```

### Deploy Event Monitor
```bash
# Update wrangler.toml: set main = "agents/event-monitor.js"
# Note: requires only DB binding, no API keys
wrangler deploy
```

### Deploy Community Validator
```bash
# Update wrangler.toml: set main = "agents/community-validator.js"
wrangler deploy
```

### Deploy Social Intelligence
```bash
# Update wrangler.toml: set main = "agents/social-intelligence.js"
wrangler deploy
```

## Step 5: Configure Cloudflare Routes

Map the agents to your domain in Cloudflare Dashboard:

1. **For legal-monitor, news-monitor, event-monitor:**
   - Dashboard → your domain → Workers → Routes
   - Create route: `wanderingwithpride.com/api/wandersafe/*`
   - Route to the deployed Worker

2. **For community-validator (webhook + admin interface):**
   - Create route: `wanderingwithpride.com/webhook/tally`
   - Route to community-validator Worker
   - Create route: `wanderingwithpride.com/wandersafe-admin/*`
   - Route to community-validator Worker

## Step 6: Verify Deployment

```bash
# Check worker logs
wrangler tail <worker-name>

# Test an endpoint
curl https://wanderingwithpride.com/api/wandersafe/legal-monitor
# Expected response: { "agent": "legal-monitor", "status": "ok", ... }

# For community-validator admin interface
curl https://wanderingwithpride.com/wandersafe-admin/queue \
  -u admin:YOUR_ADMIN_PASSWORD
```

## Monitoring & Logs

View live logs from a deployed Worker:
```bash
wrangler tail wandersafe-legal-monitor
```

Access the admin interface for community reports:
```
https://wanderingwithpride.com/wandersafe-admin/queue
Username: admin
Password: (what you set in ADMIN_PASSWORD)
```

## Troubleshooting

### "Database binding not found"
- Verify `database_id` in wrangler.toml matches the actual D1 ID
- Run: `wrangler d1 list`

### "Secret not found"
- Verify the secret was set: `wrangler secret list`
- Secrets must be set BEFORE deploying the Worker that uses them

### Scheduled triggers not firing
- Verify cron expression in wrangler.toml is valid
- Check Cloudflare dashboard → your Worker → Triggers → Crons
- Logs will show if a scheduled run was attempted

### API rate limits
- Equaldex: 100 req/day (legal-monitor runs every 6 hours = 4 req/day per country)
- Brave Search: 2,000 req/month (news-monitor runs every 2 hours = ~360 req/month)
- Check agent logs for rate limit errors

## Deployment Checklist

- [ ] wrangler.toml has correct `database_id`
- [ ] D1 schema applied: `wrangler d1 execute wandersafe --file=schema/d1-schema.sql`
- [ ] All required secrets set via `wrangler secret put`
- [ ] Each agent deployed with correct `main` path in wrangler.toml
- [ ] Cloudflare routes configured for each agent
- [ ] Admin interface accessible at `/wandersafe-admin/*`
- [ ] Webhook configured in Tally form to point to `/webhook/tally`
- [ ] Test API endpoints return expected responses
- [ ] View logs: `wrangler tail <worker-name>`

## Next Steps

1. Populate the `destinations` table with your target locations
2. Configure the admin interface to review and approve alerts
3. Set up alerting/notification for your review team
4. Monitor agent runs for errors in Cloudflare Dashboard
