# WanderSafe Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1%20Database-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)

**WanderSafe** is an LGBTQ+ travel safety intelligence platform built by [Wandering With Pride](https://wanderingwithpride.com). It synthesizes legal data, government advisories, community reports, and legislative monitoring into structured, human-reviewed safety intelligence for LGBTQ+ travelers.

This repository contains the open-source monitoring agent pipeline that powers WanderSafe.

- **Live platform**: https://wanderingwithpride.com
- **152 destination pages**: https://wanderingwithpride.com/wandersafe/
- **Methodology**: https://wanderingwithpride.com/wandersafe/methodology.html

---

## Why This Is Open Source

Queer safety intelligence should not be locked behind a platform. A Kenyan trans rights organization, a Filipino LGBTQ+ student group, or a Brazilian activist collective should be able to run this pipeline for their own community — monitoring their own country's laws, local news, and community reports — without asking permission or paying a subscription.

This repo is MIT licensed. The data schema and agent interfaces are documented so any organization can fork, adapt, and run their own instance.

---

## Architecture: Cloudflare Workers Pipeline

WanderSafe runs on four active Cloudflare Workers backed by a D1 database, plus three stub agents planned for future releases.

### Active Workers

| Worker | File | Data Sources | Schedule | Status |
|---|---|---|---|---|
| wandersafe-admin | `agents/index.js` | Admin queue, D1 database | On request | **Active** |
| wandersafe-legal-monitor | `agents/legal-monitor.js` | Equaldex API, LegiScan, US State Dept RSS | Weekly Mon 06:00 UTC | **Active** |
| wandersafe-community-validator | `agents/community-validator.js` | Traveler-submitted reports (Tally webhook → D1), Claude Haiku validation | On webhook receipt | **Active** |
| wandersafe-intel | `agents/news-monitor.js` | PinkNews, HRW, LGBTQ Nation, The Advocate RSS; Brave Search API | Daily 06:00 UTC | **Active** |

### Coming Soon (Stubs Present)

| Agent | File | Status |
|---|---|---|
| News Monitor | `agents/news-monitor.js` (extended) | Coming Soon |
| Event Monitor | `agents/event-monitor.js` | Coming Soon |
| Social Intelligence | `agents/social-intelligence.js` | Coming Soon |

All agents output structured alerts. **Nothing publishes without human review and approval.**

---

## Live Destinations

**152 destination pages** are live at [wanderingwithpride.com/wandersafe/](https://wanderingwithpride.com/wandersafe/), covering destinations across 6 continents. URL format: `wanderingwithpride.com/wandersafe/[city-country].html`

**Pipeline status (April 2026):**
- wandersafe-legal-monitor: **Active** — polling Equaldex API + US State Department weekly
- wandersafe-intel: **Active** — ingesting PinkNews, HRW, LGBTQ Nation, The Advocate daily
- wandersafe-community-validator: **Active** — processing Tally form submissions with Claude Haiku validation
- wandersafe-admin: **Active** — human review queue for alerts before publication

Sample destinations:

| Destination | Safety Tier | URL |
|---|---|---|
| Madrid, Spain | Safe | [wandersafe/madrid-spain.html](https://wanderingwithpride.com/wandersafe/madrid-spain.html) |
| Berlin, Germany | Safe | [wandersafe/berlin-germany.html](https://wanderingwithpride.com/wandersafe/berlin-germany.html) |
| Bangkok, Thailand | Safe | [wandersafe/bangkok-thailand.html](https://wanderingwithpride.com/wandersafe/bangkok-thailand.html) |
| Cape Town, South Africa | Caution | [wandersafe/cape-town-south-africa.html](https://wanderingwithpride.com/wandersafe/cape-town-south-africa.html) |
| Uganda | High Risk | [wandersafe/uganda.html](https://wanderingwithpride.com/wandersafe/uganda.html) |

---

## Repository Structure

```
wandersafe-agents/
├── agents/
│   ├── index.js                  # wandersafe-admin: human review queue
│   ├── legal-monitor.js          # wandersafe-legal-monitor: Equaldex + LegiScan + State Dept
│   ├── community-validator.js    # wandersafe-community-validator: Tally webhook + Claude Haiku
│   ├── news-monitor.js           # wandersafe-intel: LGBTQ+ news RSS + Brave Search
│   ├── event-monitor.js          # STUB: Event monitoring (Coming Soon)
│   └── social-intelligence.js   # STUB: Public social media signals (Coming Soon)
├── schema/
│   └── d1-schema.sql             # Cloudflare D1 database schema
├── docs/
│   └── methodology.md            # Full methodology documentation
├── SCORING.md                    # 4-category scoring model, data sources, methodology
├── CONTRIBUTING.md               # How to contribute, report issues, suggest destinations
├── CODE_OF_CONDUCT.md            # Contributor Covenant v2.1
└── README.md
```

---

## Requirements

To run this pipeline for your own community:

1. **Cloudflare Workers account** — free tier is sufficient for small-scale monitoring
2. **Cloudflare D1 database** — serverless SQLite, included in Workers free tier
3. **Equaldex API key** — free at [equaldex.com/api](https://www.equaldex.com/api) — legal status data for 200+ countries
4. **Anthropic API key** — for Claude-powered community report classification (pay-per-use, ~$5/month at low volume)
5. **Tally.so account** — community report intake form (free tier available); configure the webhook to point at your `wandersafe-community-validator` Worker
6. **LegiScan API key** — free at [legiscan.com](https://legiscan.com) — US state and federal legislation tracking
7. **Brave Search API key** — for news monitoring (free tier available)
8. **Optional**: Reddit API credentials for social monitoring (free tier)

---

## Quickstart

```bash
# Clone the repo
git clone https://github.com/WanderingWithPride/wandersafe-agents.git
cd wandersafe-agents

# Install dependencies
npm install

# Set up your D1 database
wrangler d1 create wandersafe
wrangler d1 execute wandersafe --file=schema/d1-schema.sql

# Set required secrets via Cloudflare dashboard or wrangler:
#   wrangler secret put EQUALDEX_API_KEY
#   wrangler secret put LEGISCAN_API_KEY
#   wrangler secret put ANTHROPIC_API_KEY
#   wrangler secret put TALLY_WEBHOOK_SECRET
#   wrangler secret put ADMIN_PASSWORD
#   wrangler secret put BRAVE_API_KEY
# (Never commit secrets to this repository)

# Deploy the active workers
wrangler deploy agents/index.js --name wandersafe-admin
wrangler deploy agents/legal-monitor.js --name wandersafe-legal-monitor
wrangler deploy agents/community-validator.js --name wandersafe-community-validator
wrangler deploy agents/news-monitor.js --name wandersafe-intel
```

---

## Environment Variables

These variable **names** are documented here. Values must be set as Cloudflare Worker secrets — never committed to this repository.

| Variable | Required By | Source |
|---|---|---|
| `EQUALDEX_API_KEY` | wandersafe-legal-monitor | equaldex.com/api (free) |
| `LEGISCAN_API_KEY` | wandersafe-legal-monitor | legiscan.com (free) |
| `ANTHROPIC_API_KEY` | wandersafe-community-validator | console.anthropic.com |
| `TALLY_WEBHOOK_SECRET` | wandersafe-community-validator | Tally.so webhook settings |
| `ADMIN_PASSWORD` | wandersafe-admin | Generate a strong password |
| `BRAVE_API_KEY` | wandersafe-intel | api.search.brave.com (free tier) |

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

Every alert generated by these agents goes into a `human_reviewed = false` queue managed by `wandersafe-admin`. A trained human reviewer assesses:

- Source credibility
- Geographic specificity
- Severity classification
- Whether the incident represents a pattern or an outlier

Only after approval does anything reach the public platform. This is a non-negotiable design constraint. See `docs/methodology.md` for full detail.

---

## Scoring Model

WanderSafe uses a 4-category scoring model:

| Category | Weight | Description |
|---|---|---|
| Legal Environment | Highest | Criminalization status, penalty severity, enforcement level |
| Social Climate | High | Documented community violence, vigilante patterns, social acceptance |
| Safety & Security | Medium | State Dept advisories, documented traveler incidents, digital surveillance |
| Healthcare Access | Medium | Emergency services, LGBTQ+-affirming care availability |

Scores are adjusted for trans/nonbinary identities where demographic-specific data is available. See [SCORING.md](SCORING.md) for the full methodology.

---

## Secrets Audit

No secrets or API keys are committed in this repository. All sensitive values are managed as Cloudflare Worker secrets via `wrangler secret put`. If you discover a committed secret in the git history, please report it as a security vulnerability via the process in CONTRIBUTING.md.

---

## Data License

Agent code: **MIT License** (see LICENSE)

Safety intelligence data published through the WanderSafe platform: **CC BY 4.0** — you may use, share, and adapt it with attribution.

Community-submitted reports are anonymized before publication. No personal identifying information is stored after the validation pipeline runs.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Maintainer

Michael Eisinger — [Wandering With Pride](https://wanderingwithpride.com) — michael@wanderingwithpride.com
