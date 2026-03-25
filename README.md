# WanderSafe Agents

**WanderSafe** is an LGBTQ+ travel safety intelligence platform built by [Wandering With Pride](https://wanderingwithpride.com). It synthesizes legal data, government advisories, news monitoring, community reports, and social signals into structured, human-reviewed safety intelligence for every destination.

This repository contains the open-source monitoring agent pipeline that powers WanderSafe.

- **Live platform**: https://wanderingwithpride.com
- **Methodology**: https://wanderingwithpride.com/wandersafe-methodology.html

---

## Why This Is Open Source

Queer safety intelligence should not be locked behind a platform. A Kenyan trans rights organization, a Filipino LGBTQ+ student group, or a Brazilian activist collective should be able to run this pipeline for their own community — monitoring their own country's laws, local news, and community reports — without asking permission or paying a subscription.

This repo is MIT licensed. The data schema and agent interfaces are documented so any organization can fork, adapt, and run their own instance.

---

## Architecture: The 5-Agent Pipeline

WanderSafe runs five specialized monitoring agents, each responsible for a distinct data layer:

| Agent | File | Data Sources | Schedule | Status |
|---|---|---|---|---|
| Legal Monitor | `agents/legal-monitor.js` | Equaldex API, U.S. State Dept RSS, LegiScan | Weekly Mon 06:00 UTC | Implemented |
| News Monitor | `agents/news-monitor.js` | PinkNews, LGBTQ Nation, HRW, The Advocate RSS | Daily 06:00 UTC | Stub |
| Event Monitor | `agents/event-monitor.js` | Pride organization sites, IGLTA, local event feeds | Weekly Tue 06:00 UTC | Stub |
| Community Validator | `agents/community-validator.js` | Traveler-submitted reports (Tally webhook → D1) | On webhook receipt | Implemented |
| Social Intelligence | `agents/social-intelligence.js` | Reddit r/gaytravellers, r/LGBTtravel, r/lgbt; public social posts | Not scheduled (request-driven) | Stub |

All agents output structured alerts. **Nothing publishes without human review and approval.**

---

## Repository Structure

```
wandersafe-agents/
├── agents/
│   ├── legal-monitor.js          # Equaldex + State Dept + LegiScan
│   ├── news-monitor.js           # LGBTQ+ news RSS feeds
│   ├── event-monitor.js          # Pride events and cancellations
│   ├── community-validator.js    # Traveler report processing
│   └── social-intelligence.js   # Public social media signals
├── schema/
│   └── d1-schema.sql             # Cloudflare D1 database schema
├── docs/
│   └── methodology.md            # Full methodology documentation
├── CONTRIBUTING.md
└── README.md
```

---

## Requirements

To run this pipeline for your own community:

1. **Cloudflare Workers account** — free tier is sufficient for small-scale monitoring
2. **Cloudflare D1 database** — serverless SQLite, included in Workers free tier
3. **Equaldex API key** — free at [equaldex.com/api](https://www.equaldex.com/api) — legal status data for 200+ countries
4. **Anthropic API key** — for Claude-powered community report classification (pay-per-use, ~$5/month at low volume)
5. **Tally.so account** — community report intake form (free tier available); configure the webhook to point at your community-validator Worker
6. **Optional**: Reddit API credentials for social monitoring (free tier)
7. **Optional**: RSS feed access to PinkNews, HRW, LGBTQ Nation (all public, no API key required)

---

## Quickstart

```bash
# Clone the repo
git clone https://github.com/WanderingWithPride/wandersafe-agents.git
cd wandersafe-agents

# Install dependencies
npm install

# Run the test suite to verify everything works
npm test

# Set up your D1 database
wrangler d1 create wandersafe
wrangler d1 execute wandersafe --file=schema/d1-schema.sql

# Set environment variables in Cloudflare Workers dashboard (never commit these):
#   EQUALDEX_API_KEY       — from equaldex.com/api
#   ANTHROPIC_API_KEY      — from console.anthropic.com
#   TALLY_WEBHOOK_SECRET   — from your Tally form webhook settings
#   ADMIN_PASSWORD         — password for the /admin/queue review interface
#   LEGISCAN_API_KEY       — from legiscan.com (US bill tracking)

# Deploy agents as Cloudflare Workers
wrangler deploy agents/legal-monitor.js
wrangler deploy agents/community-validator.js
wrangler deploy agents/news-monitor.js
# ... etc
```

---

## Running Your Own Instance

If you are an LGBTQ+ organization outside the US, you can run this pipeline entirely for your own country or region:

1. Fork this repo
2. Focus the agents on your relevant data sources (modify the RSS feed list in `news-monitor.js`, set country filters in `legal-monitor.js`)
3. Deploy to your own Cloudflare Workers account
4. Connect to your own community report intake form
5. All data stays in your own D1 instance — nothing is shared back to WanderSafe unless you choose to

We actively want to support organizations doing this. Open an issue or email the maintainer at the address in CONTRIBUTING.md.

---

## Human Review Requirement

Every alert generated by these agents goes into a `human_reviewed = false` queue. A trained human reviewer assesses:

- Source credibility
- Geographic specificity
- Severity classification
- Whether the incident represents a pattern or an outlier

Only after approval does anything reach the public platform. This is a non-negotiable design constraint. See `docs/methodology.md` for full detail.

---

## Data License

Agent code: **MIT License** (see LICENSE)

Safety intelligence data published through the WanderSafe platform: **CC BY 4.0** — you may use, share, and adapt it with attribution.

Community-submitted reports are anonymized before publication. No personal identifying information is stored after the validation pipeline runs.

---

## Live Destinations

Ten destination pages are now live, each powered by this pipeline and updated as conditions change:

| Destination | URL | Notes |
|---|---|---|
| Madrid, Spain | [wanderingwithpride.com/wandersafe-madrid.html](https://wanderingwithpride.com/wandersafe-madrid.html) | LGBTQ+ hub, home of Madrid Bear Week (Osos) |
| Barcelona, Spain | [wanderingwithpride.com/wandersafe-barcelona.html](https://wanderingwithpride.com/wandersafe-barcelona.html) | Pride capital with one of Europe's largest Pride festivals |
| Puerto Vallarta, Mexico | [wanderingwithpride.com/wandersafe-puerto-vallarta.html](https://wanderingwithpride.com/wandersafe-puerto-vallarta.html) | Mexico's most established LGBTQ+ resort destination |
| Krakow, Poland | [wanderingwithpride.com/wandersafe-krakow.html](https://wanderingwithpride.com/wandersafe-krakow.html) | Central European destination with evolving legal context |
| Rwanda, East Africa | [wanderingwithpride.com/wandersafe-rwanda.html](https://wanderingwithpride.com/wandersafe-rwanda.html) | High-demand destination with complex safety picture for LGBTQ+ travelers |
| Rome, Italy | [wanderingwithpride.com/wandersafe-rome.html](https://wanderingwithpride.com/wandersafe-rome.html) | Major European destination with conservative political undercurrents |
| Berlin, Germany | [wanderingwithpride.com/wandersafe/berlin-germany.html](https://wanderingwithpride.com/wandersafe/berlin-germany.html) | LGBTQ+ capital of Europe with globally recognized queer infrastructure |
| Amsterdam, Netherlands | [wanderingwithpride.com/wandersafe/amsterdam-netherlands.html](https://wanderingwithpride.com/wandersafe/amsterdam-netherlands.html) | First country to legalize same-sex marriage, strong legal protections |
| Bangkok, Thailand | [wanderingwithpride.com/wandersafe/bangkok-thailand.html](https://wanderingwithpride.com/wandersafe/bangkok-thailand.html) | Visible LGBTQ+ scene with legal protections lagging social acceptance |
| Buenos Aires, Argentina | [wanderingwithpride.com/wandersafe/buenos-aires-argentina.html](https://wanderingwithpride.com/wandersafe/buenos-aires-argentina.html) | Pride capital of South America with comprehensive legal protections |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Maintainer

Michael Eisinger — [Wandering With Pride](https://wanderingwithpride.com)
