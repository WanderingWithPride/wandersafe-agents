# Contributing to WanderSafe

WanderSafe is an open-source LGBTQ+ travel safety intelligence platform. There are several ways to contribute.

## Submit a Community Safety Report

The most valuable contribution is sharing your travel experience. If you have traveled to a destination as an LGBTQ+ person, your report helps other travelers make safer decisions.

**[Submit a report](https://tally.so/r/BzBaLR)** — takes 5 minutes, reviewed by a human before publishing, your identity is never published.

## Report a Data Error

If a destination safety rating, legal status, or emergency contacts are incorrect or outdated:

1. [Open an issue](https://github.com/WanderingWithPride/wandersafe-agents/issues/new?labels=data-correction) with the `data-correction` label
2. Include: which destination, what is wrong, and a source for the correct information
3. We will investigate and update within 48 hours

## Request a New Destination

Want WanderSafe to cover a destination not yet on the platform?

1. [Open an issue](https://github.com/WanderingWithPride/wandersafe-agents/issues/new?labels=destination-request) with the `destination-request` label
2. Include: destination name, why it matters for LGBTQ+ travelers, and any data sources you know of
3. Destinations are added as full pages at `wanderingwithpride.com/wandersafe/[city-country].html`

## Report a Security Vulnerability

Do not open a public issue for security vulnerabilities. Email michael@wanderingwithpride.com with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 72 hours and coordinate a fix before any public disclosure.

## Fork and Run Your Own Instance

WanderSafe is designed so regional LGBTQ+ organizations can run independent instances. See the README for setup instructions. The code is MIT licensed, the methodology is CC BY 4.0.

## Code Contributions

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Submit a pull request against `main`

All PRs require human review before merge. If your PR includes AI-generated code, please disclose that in the PR description.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- A [Cloudflare account](https://cloudflare.com) (free tier is sufficient)

### Local Setup

```bash
git clone https://github.com/WanderingWithPride/wandersafe-agents.git
cd wandersafe-agents
npm install
```

### Database Setup

```bash
# Create a local D1 database for development
wrangler d1 create wandersafe-dev
wrangler d1 execute wandersafe-dev --local --file=schema/d1-schema.sql
```

### Environment Variables

Set the following as Cloudflare Worker secrets (never commit values):

| Variable | Description | Where to Get It |
|---|---|---|
| `EQUALDEX_API_KEY` | Legal status data | equaldex.com/api (free) |
| `LEGISCAN_API_KEY` | US legislation tracking | legiscan.com (free) |
| `ANTHROPIC_API_KEY` | Claude Haiku for report validation | console.anthropic.com |
| `TALLY_WEBHOOK_SECRET` | Community report form webhook | Tally.so webhook settings |
| `ADMIN_PASSWORD` | Admin review queue access | Generate a strong random password |
| `BRAVE_API_KEY` | News search | api.search.brave.com (free tier) |

Set secrets via:

```bash
wrangler secret put EQUALDEX_API_KEY
# (repeat for each secret)
```

### Deploy a Worker Locally

```bash
# Test a specific worker locally
wrangler dev agents/legal-monitor.js
```

### Deploy to Cloudflare

```bash
wrangler deploy agents/index.js --name wandersafe-admin
wrangler deploy agents/legal-monitor.js --name wandersafe-legal-monitor
wrangler deploy agents/community-validator.js --name wandersafe-community-validator
wrangler deploy agents/news-monitor.js --name wandersafe-intel
```

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions?

Email michael@wanderingwithpride.com or open a discussion on GitHub.
