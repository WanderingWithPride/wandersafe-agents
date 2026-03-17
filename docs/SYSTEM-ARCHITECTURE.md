# WanderSafe — System Architecture
> Canonical reference for all data stores, external APIs, Cloudflare Workers, and workflows.
> Version: 1.0 | March 2026 | Built on: Cloudflare Pages + Workers + D1
> Status: Design document. Core pipeline operational. Sections marked [POST-FUNDING] require grant.

---

## 1. Infrastructure Overview

| Layer | Platform | Cost |
|-------|----------|------|
| Static site hosting | Cloudflare Pages | Free |
| Database | Cloudflare D1 (SQLite-compatible) | ~$0.50/mo at current scale |
| Serverless compute | Cloudflare Workers | ~$5/mo |
| Email / newsletter | Buttondown | $9–29/mo depending on list size |
| Community forms | Tally.so | Free tier |
| Image hosting | Cloudinary | Free tier (25 credits/mo) |
| CRM (nonprofit) | CiviCRM (hosted on WWP instance) | ~$20/mo |
| Monitoring agents | Cloudflare Workers (cron triggers) | Included above |

**Total infrastructure: ~$54–150/month without grant.**
The grant buys founder time, not infrastructure.

---

## 2. External APIs

| API | Purpose | Auth | Rate / Cost | Tier needed |
|-----|---------|------|-------------|-------------|
| Equaldex | Live LGBTQ+ legal status per country | API key (header) | Free: 100 req/day; Premium: 10K/day | Free sufficient for weekly poll |
| ILGA World | Annual homophobia report data | None (PDF/manual) | Annual PDF, no API | Manual import annually |
| HRW World Report | Country report excerpts | None (web scrape) | Polite crawl only | Manual or RSS |
| US State Dept | Travel advisory levels | None (RSS) | RSS feed, unlimited | Free |
| LegiScan | US state + federal legislation | API key | Free: 30K queries/mo | Free sufficient |
| Open States (Plural) | Legislator geo + bill enrichment | API key (free) | 100 req/day free | Free |
| Buttondown | Newsletter + subscriber management | API key | Per plan | $9/mo base |
| Tally.so | Community report form | Webhook secret | Free tier | Free |
| Cloudinary | Image hosting (community photos) | API key + secret | Free: 25 credits/mo | Free to start |
| Claude API (Anthropic) | Bill classification, alert synthesis | API key | ~$0.04/1K tokens (Haiku) | Pay-per-use ~$5/mo |
| Perplexity API | News monitoring fact-check | API key | ~$5/mo at volume | Pay-per-use |
| CiviCRM REST API | Scholar/alumni/donor access mgmt | API key + site key | Self-hosted | Existing WWP infra |
| Rainbow Railroad | Emergency resource link | None | Static link | N/A |
| Riskline | LGBTQ+ risk map calibration | Manual | Annual PDF / manual | Free (public report) |

---

## 3. Cloudflare D1 Database

Full schema: `schema/d1-schema.sql` in the `wandersafe-agents` repo.

### Tables

| Table | Purpose | Updated by |
|-------|---------|-----------|
| `destinations` | Master list of all tracked destinations | Manual + Workers |
| `legal_status` | LGBTQ+ legal status per destination | legal-monitor Worker (weekly) |
| `safety_alerts` | Agent-generated alerts, pending human review | All agent Workers |
| `community_reports` | Traveler-submitted safety reports (Tally) | community-validator Worker |
| `subscribers` | Alert subscribers (email hashed, preferences) | Buttondown webhook Worker |
| `agent_runs` | Audit log of every agent execution | All agent Workers |
| `destination_scores` | Computed safety scores (see SCORING.md) | scoring Worker (on alert approval) |
| `legiscan_bills` | US state/federal LGBTQ+ bill tracking | legiscan-monitor Worker |
| `scholar_reports` | WWP scholar post-trip safety reports | Manual import + future form |
| `access_grants` | CiviCRM → WanderSafe access mapping | civicrm-sync Worker |
| `b2b_clients` | API key → client mapping for B2B tier [POST-FUNDING] | Manual provisioning |
| `circles_contacts` | In-country contact directory [POST-FUNDING] | Circles Worker |

### Key Design Rules
- `human_reviewed = 0` on all agent-generated content. Nothing surfaces publicly until a human sets `published_at`.
- PII is never stored in D1. Email addresses are SHA-256 hashed in `subscribers`. Community reporter names are stripped before insert.
- All tables have `created_at`. All mutable tables have `updated_at`.
- Foreign key constraints enforced via `PRAGMA foreign_keys = ON`.

---

## 4. Cloudflare Workers

| Worker | Trigger | What it does |
|--------|---------|-------------|
| `legal-monitor` | Cron: weekly (Mon 06:00 UTC) | Polls Equaldex API for all tracked destinations. On change: inserts `safety_alert`, logs `agent_run`. |
| `news-monitor` | Cron: daily (06:00 UTC) | Fetches RSS from PinkNews, LGBTQ Nation, HRW, The Advocate. Runs keyword match against destination names + threat terms. Flags matches as `safety_alert`. |
| `event-monitor` | Cron: weekly (Tue 06:00 UTC) | Monitors LGBTQ+ event pages for new dates or cancellations affecting tracked destinations. |
| `community-validator` | Webhook: Tally form submission | Receives report, strips PII, runs validity score (Claude Haiku), inserts to `community_reports` with `approved = 0`. Notifies Michael via email. |
| `legiscan-monitor` | Cron: daily (07:00 UTC) | Fetches changed bills from LegiScan API (change_hash delta). Classifies with Claude Haiku for LGBTQ+ relevance. Inserts flagged bills to `legiscan_bills`. |
| `scoring` | Event: triggered on alert approval | Re-runs scoring algorithm for affected destination. Updates `destination_scores`. |
| `buttondown-sync` | Webhook: Buttondown subscribe/unsubscribe | Syncs subscriber preferences to D1 `subscribers` table. |
| `civicrm-sync` | Webhook: CiviCRM contact type change | Maps CiviCRM contact type to Buttondown tags. Grants/revokes `wandersafe-premium`. Updates `access_grants`. |
| `api-gateway` | HTTP: GET /api/v1/* | B2B API endpoint. Rate-limits by API key. Returns JSON from D1. [POST-FUNDING] |
| `circles-relay` | HTTP: POST /circles/message | Encrypted message relay for Circles contacts. No message stored. [POST-FUNDING] |

---

## 5. Workflows

---

### 5.1 Agent Monitoring Loop (the core pipeline)

```
[CRON TRIGGER]
      |
      v
Worker fetches source (Equaldex API / RSS feed / LegiScan / event page)
      |
      v
Compare to last known state in D1
      |
    change? ──NO──> log agent_run(status=success, alerts_created=0) → END
      |
     YES
      |
      v
Claude Haiku classifies relevance (0–1 confidence score)
      |
  score < 0.6? ──YES──> log agent_run → END (false positive filtered)
      |
     NO
      |
      v
INSERT safety_alerts (human_reviewed=0, published_at=NULL)
INSERT agent_runs (status=success, alerts_created=N)
      |
      v
Email notification → Michael
(Subject: "[WanderSafe] New alert: {destination} — {severity}")
      |
      v
[HUMAN REVIEW — Michael, ~5–10 min]
      |
  reject? ──YES──> UPDATE safety_alerts SET reviewer_notes, human_reviewed=1 → END
      |
     NO
      |
      v
Edit/approve alert text
UPDATE safety_alerts SET human_reviewed=1, published_at=NOW()
      |
      v
[scoring Worker triggered]
Re-compute destination score → UPDATE destination_scores
      |
      v
Destination page HTML updated (static generation or live D1 query)
      |
      v
[ALERT DISPATCH]
Fetch subscribers WHERE destination_tags contains this destination
  AND alert_tier threshold met
      |
      v
Buttondown API: send digest email to matched subscribers
Tag: wandersafe-alerts-{destination_slug}
```

---

### 5.2 Community Report Pipeline

```
Traveler visits: https://tally.so/r/BzBaLR
      |
      v
Tally form submission (all 8 fields + incident type + free text)
      |
      v
Tally webhook → community-validator Worker
      |
      v
Worker: strip PII (name, email extracted for follow-up email ONLY, not stored)
Worker: normalize destination → match to destinations.id
Worker: Claude Haiku validity check
  - Is it plausible for this destination?
  - Is it specific (not generic praise/complaint)?
  - Does it contradict primary source data in a way needing flagging?
  → validity_score (0.0–1.0), validity_notes
      |
      v
INSERT community_reports (approved=0, validity_score, validity_notes)
      |
      v
Email notification → Michael
(Subject: "[WanderSafe] New community report: {destination}")
      |
      v
[HUMAN REVIEW — Google Sheets moderation queue]
Review checklist:
  □ Safety info specific and plausible
  □ No identifiable strangers in photos
  □ EXIF stripped from photos before publish
  □ Legal claim consistent with Equaldex
  □ No named individuals who haven't consented
  □ Permission checkboxes confirmed
      |
  reject? ──YES──> UPDATE approved=0, reviewer_notes → END
      |
     NO
      |
      v
Update community_reports SET approved=1, published_at=NOW()
Upload photos → Cloudinary (EXIF stripped)
Generate HTML block → inject into destination page
      |
      v
Redeploy destination page
```

---

### 5.3 Subscriber Access Flow

```
[PUBLIC SUBSCRIBE]
Traveler enters email on wandersafe-alerts tag subscription form
      |
      v
Buttondown webhook → buttondown-sync Worker
Hash email (SHA-256) → INSERT subscribers (email_hash, buttondown_id, alert_tier)
      |
      v
Buttondown sends: welcome email + wandersafe-alerts tag applied

[DESTINATION PREFERENCE UPDATE]
Subscriber selects destinations on preference page (future)
      |
      v
Preference Worker → UPDATE subscribers SET destination_tags = [...]
Buttondown: apply destination-specific tags

[WWP-AFFILIATED ACCESS]
CiviCRM contact type change (Scholar / Alumni / Board / Advisor / Donor)
      |
      v
CiviCRM webhook → civicrm-sync Worker
Worker maps contact type → Buttondown tags:
  Scholar        → [wandersafe-premium, scholar, wandersafe-{destination}]
  Alumni         → [wandersafe-premium, alumni]
  Board Member   → [wandersafe-premium, board]
  Advisor        → [wandersafe-premium, advisor]
  Sustaining Donor → [wandersafe-premium, donor]
  Lapsed         → REMOVE wandersafe-premium
INSERT/UPDATE access_grants (civicrm_contact_id, buttondown_id, tier, expires_at)
      |
      v
Buttondown: send "Welcome to WanderSafe" email with premium access confirmation
```

---

### 5.4 Scholar Pre-Departure + Post-Trip Flow

```
[AWARD NOTIFICATION]
Scholar awarded → CiviCRM contact created/updated
      |
      v
civicrm-sync Worker applies:
  - Buttondown tag: wandersafe-premium
  - Buttondown tag: wandersafe-{destination country slug}
      |
      v
Pre-departure automated email (Buttondown sequence, tag-triggered):
  - WanderSafe destination page for their country
  - Smart travel tech recommendations (VPN, eSIM, apps)
  - Emergency contacts for their destination
  - STEP enrollment reminder
  - Community report request: "When you return, your report helps future scholars"

[POST-TRIP REPORTING]
Scholar completes post-trip report (WWP form, Tally)
WanderSafe section captured (all Layer 6 fields)
      |
      v
community-validator Worker (same pipeline as public reports)
  EXCEPT: audience_tags auto-set ['wwp_scholar']
           badge = 'WWP Scholar'
      |
      v
Michael reviews → approves → publishes with "WWP Scholar" badge
```

---

### 5.5 Newsletter (Safety Digest) Workflow

```
[WEEKLY DIGEST ASSEMBLY — Michael, ~30 min]

1. Review safety_alerts WHERE published_at > 7 days ago
   - Pull top 3 by severity + destination traffic
2. Select 2 destination spotlights (one green, one amber/red)
3. Pull approved community_reports from past 30 days (newest 3)
4. Write Resource of the Week (Rainbow Railroad, OutRight, etc.)
5. Note upcoming destinations being added

      |
      v
Draft in Buttondown → plain text + markdown
Tag: wandersafe-alerts (all subscribers)
      |
      v
Schedule for send (Tuesday 9am ET)
      |
      v
[BREAKING ALERT — immediate send]
On approval of critical/high severity alert:
  → Buttondown API: send single-destination alert immediately
  → Tag: wandersafe-alerts-{destination_slug}
  → Subject: "WanderSafe Alert: {destination} — {one-line summary}"
```

---

### 5.6 LegiScan US Domestic Monitoring

```
[DAILY CRON — legiscan-monitor Worker]

For each tracked state (all 50 + Congress):
  GET /getDatasetList → compare change_hash to stored hash in legiscan_bills
      |
  hash unchanged? ──YES──> skip (no API credit consumed)
      |
     NO
      |
      v
GET /getDataset → fetch changed bill text
      |
      v
Claude Haiku classifier:
  Prompt: "Does this bill relate to LGBTQ+ rights, trans healthcare,
  gender recognition, anti-drag, HIV criminalization, or public
  accommodation for LGBTQ+ people? Answer YES/NO with confidence 0-1."
      |
  confidence < 0.7? ──YES──> skip
      |
     NO
      |
      v
INSERT legiscan_bills:
  (bill_id, state, bill_number, title, status, introduced_date,
   last_action, lgbtq_relevance_score, lgbtq_relevance_summary,
   open_states_id, affected_destinations)
      |
      v
Map bill → affected_destinations (state-level → US domestic destination pages)
INSERT safety_alert (agent_type='legal', severity computed from bill status)
      |
      v
Normal human review flow → publish → subscriber alert
```

---

### 5.7 B2B API Flow [POST-FUNDING]

```
B2B Client (Grindr, university, tour operator, insurance co.)
      |
GET https://api.wanderingwithpride.com/v1/destination/{slug}/rating
Authorization: Bearer {api_key}
      |
      v
api-gateway Worker:
  Validate API key → lookup b2b_clients → check rate limit
  Query D1: SELECT safety_tier, legal_status, last_updated FROM destinations
             JOIN destination_scores WHERE id = {slug}
      |
      v
Return JSON:
  {
    "destination": "EG",  // Egypt
    "safety_tier": 3,     // high_risk
    "score": 31,
    "legal_status": "criminalized",
    "last_updated": "2026-03-10T14:22:00Z",
    "methodology_url": "https://wanderingwithpride.com/wandersafe-methodology.html"
  }
```

---

### 5.8 Circles Encrypted Relay [POST-FUNDING]

```
[CONTACT REGISTRATION]
Subscriber opts in as in-country contact
  → SELECT destinations they know
  → SET availability: emergency_only | open_to_connect
  → Generate E2E keypair (client-side, private key never leaves device)
  → INSERT circles_contacts (destination_id, public_key, availability, verified_at)

[TRAVELER INITIATES CONTACT]
Traveler on destination page: "Connect with a local contact"
  → Fetch contact's public key from D1
  → Encrypt message client-side with contact's public key
  → POST /circles/message (encrypted payload only — WanderSafe cannot read it)
      |
      v
circles-relay Worker:
  Validate sender is authenticated subscriber
  Forward encrypted payload to contact via Buttondown transactional email
  Log: message_sent (no content stored — only metadata: from_destination, timestamp)
      |
      v
Contact receives email with encrypted payload
  → Decrypts client-side with their private key
  → Replies via secure channel

NOTHING IS STORED ON WANDERSAFE SERVERS IN READABLE FORM.
```

---

## 6. Data Flow Diagram (text)

```
EXTERNAL SOURCES                    CLOUDFLARE WORKERS              D1 DATABASE
─────────────────                   ──────────────────              ──────────
Equaldex API ──────────────────────> legal-monitor ──────────────> legal_status
                                                   ──────────────> safety_alerts
                                                   ──────────────> agent_runs

RSS (PinkNews/HRW/Advocate) ───────> news-monitor  ──────────────> safety_alerts
                                                    ─────────────> agent_runs

Event sites ────────────────────────> event-monitor ─────────────> safety_alerts

LegiScan API ───────────────────────> legiscan-monitor ──────────> legiscan_bills
Open States API ───────────────────/                  ──────────> safety_alerts

Tally form ─────────────────────────> community-validator ───────> community_reports

Buttondown webhook ─────────────────> buttondown-sync ───────────> subscribers

CiviCRM webhook ────────────────────> civicrm-sync ──────────────> access_grants
                                                    ──[Buttondown API]> subscribers

                    [ON ALERT APPROVAL]
                    scoring Worker ──────────────────────────────> destination_scores

OUTPUTS                             CLOUDFLARE WORKERS              EXTERNAL DELIVERY
───────                             ──────────────────              ─────────────────
D1 safety_alerts ──[published]────> static page update ──────────> Cloudflare Pages
D1 destination_scores ────────────> static page update ──────────> Cloudflare Pages
D1 community_reports ─[approved]──> static page update ──────────> Cloudflare Pages

D1 subscribers ────────────────────> alert dispatch ─────────────> Buttondown → email

B2B clients ───────────────────────> api-gateway ────────────────> JSON response
```

---

## 7. Access Control Matrix

| User Type | Destination Pages | Alerts Email | Community Reports | Circles | B2B API |
|-----------|:-----------------:|:------------:|:-----------------:|:-------:|:-------:|
| General public | Read | No | Read (approved only) | No | No |
| Free subscriber | Read | Buttondown free | Read | No | No |
| WanderSafe+ ($4.99/mo) | Read | Buttondown paid | Read + Submit | Yes [PF] | No |
| WWP Scholar | Read | Premium | Read + Submit | Yes [PF] | No |
| WWP Alumni | Read | Premium | Read + Submit | Yes [PF] | No |
| WWP Board/Advisor | Read | Premium | Read + Submit | Yes [PF] | No |
| B2B client | API only | No | No | No | Yes [PF] |
| Michael | Full admin | All | Full CRUD | Admin | Full |

[PF] = Post-funding

---

## 8. What's Built vs. Designed

| Component | Status |
|-----------|--------|
| D1 schema | Designed + documented |
| Destination pages (20) | Live |
| Agent stubs (5) | Published on GitHub (not yet running on Workers) |
| Legal monitor Worker | Designed |
| News monitor Worker | Designed |
| Community-validator Worker | Designed |
| LegiScan monitor | Designed |
| Scoring Worker | Designed (algorithm in SCORING.md) |
| Buttondown newsletter | Account exists; wandersafe-alerts tag pending setup |
| Tally form | https://tally.so/r/BzBaLR (verify live) |
| CiviCRM → Buttondown Worker | Designed (manual process until built) |
| B2B API gateway | Designed [POST-FUNDING] |
| Circles relay | Designed [POST-FUNDING] |
| Mobile app | Roadmap 2027 [POST-FUNDING] |

---

## 9. Secrets & Environment Variables

All secrets stored in Cloudflare Workers environment (encrypted at rest). Never in code.

| Secret | Used by | Where to set |
|--------|---------|-------------|
| `EQUALDEX_API_KEY` | legal-monitor | Workers environment |
| `LEGISCAN_API_KEY` | legiscan-monitor | Workers environment |
| `OPEN_STATES_API_KEY` | legiscan-monitor | Workers environment |
| `ANTHROPIC_API_KEY` | community-validator, legiscan-monitor | Workers environment |
| `PERPLEXITY_API_KEY` | news-monitor | Workers environment |
| `BUTTONDOWN_API_KEY` | buttondown-sync, alert dispatch | Workers environment + ~/.zshrc |
| `TALLY_WEBHOOK_SECRET` | community-validator | Workers environment |
| `CLOUDINARY_API_KEY` | community-validator | Workers environment |
| `CLOUDINARY_API_SECRET` | community-validator | Workers environment |
| `CIVICRM_API_KEY` | civicrm-sync | Workers environment |
| `CIVICRM_SITE_KEY` | civicrm-sync | Workers environment |
| `NOTIFICATION_EMAIL` | All agents | Workers environment (michael@wanderingwithpride.org) |

---

## 10. Repository Structure

### wandersafe-agents (public — MIT)
```
wandersafe-agents/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SCORING.md
├── PRIVACY.md
├── GOVERNANCE.md
├── agents/
│   ├── legal-monitor.js
│   ├── news-monitor.js
│   ├── event-monitor.js
│   ├── community-validator.js
│   └── social-intelligence.js
├── schema/
│   └── d1-schema.sql
├── docs/
│   └── methodology.md
└── .github/
    └── ISSUE_TEMPLATE/
        ├── destination-request.md
        └── data-correction.md
```

### wandersafe-grant (private)
```
wandersafe-grant/
├── prd.md + prd-phase2.md
├── full-application-answers.md
├── SYSTEM-ARCHITECTURE.md     ← this file
├── scoring-algorithm.md
├── privacy-policy.md
├── data-governance.md
├── beta-recruitment-brief.md
├── demo-script.md
├── press-kit.md
├── safety-digest-demo.md
├── social-launch-posts.md
├── seeded-community-reports.md
├── architecture-diagram.svg
├── architecture-diagram-simple.svg
├── outreach/ (60+ email drafts)
└── letters/
```

---

## 11. Key Open Questions (design decisions not yet finalized)

1. **Static vs. dynamic destination pages:** Do Workers query D1 live per request, or does a build step regenerate static HTML? Static is simpler and free. Dynamic enables real-time scores but adds Worker invocation cost.

2. **Scoring Worker trigger:** Does scoring re-run on every alert approval, or on a schedule (nightly)? Per-alert is more responsive; scheduled is simpler.

3. **Buttondown vs. custom email for alerts:** Buttondown handles list management well but costs per subscriber. At scale (1K+ subscribers), a Cloudflare Worker sending via Resend/Postmark may be cheaper.

4. **Circles encryption library:** Client-side E2E encryption needs a browser-compatible library. Options: TweetNaCl.js (lightweight, audited), libsodium.js (full-featured), Signal Protocol (complex). Decision deferred to Circles build phase.

5. **B2B API versioning:** v1 designed above. Need to decide whether B2B clients get raw D1 data or processed safety scores only.

6. **Scholar form integration:** Current post-trip report is a separate WWP form. Adding WanderSafe section to the same Tally form vs. a separate form that feeds the same D1 table.

---

## See Also

- [SCORING.md](SCORING.md) — complete safety scoring algorithm
- [PRIVACY.md](PRIVACY.md) — community reporter data protection
- [GOVERNANCE.md](GOVERNANCE.md) — editorial independence + data rights
- [ROADMAP.md](https://github.com/WanderingWithPride/HomeBase) — HomeBase projects/wandersafe/ROADMAP.md
- [Full Spec](https://github.com/WanderingWithPride/wandersafe-grant) — /Users/michael/money-claude/wandersafe-full-spec.md
