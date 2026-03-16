# Contributing to WanderSafe Agents

Thank you for your interest in contributing to WanderSafe. This is an LGBTQ+ safety intelligence project — contributions that improve accuracy, expand coverage, or help other organizations run their own instances are especially welcome.

---

## How to Contribute

### Report an Issue

- Use GitHub Issues to report bugs, data errors, or gaps in coverage
- For safety-critical issues (e.g., an agent silently failing to detect a policy change), label the issue `urgent`
- Do not include any API keys or credentials in issues

### Submit a Pull Request

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Run any available tests: `npm test`
5. Submit a PR with a clear description of what you changed and why

### Add a New Data Source

If you know of a reliable LGBTQ+ news source, government data feed, or safety database not currently included:

1. Open an issue describing the source (URL, data format, reliability, access requirements)
2. If it requires an API key, document the registration process without including the actual key
3. Add the source stub to the relevant agent file with JSDoc documentation

### Run an Instance for Your Organization

If you are an LGBTQ+ organization and want to run this pipeline for your community:

1. Fork the repo
2. Follow the Quickstart in README.md
3. Open an issue with the label `new-instance` — we will help you configure it for your region
4. You do not need to merge back into this repo unless your changes would benefit everyone

---

## Code Standards

- All agent files are Cloudflare Workers-compatible JavaScript (ES2022)
- Use JSDoc for all exported functions
- No credentials, API keys, or personal data in any committed file
- All schema changes must be backward-compatible or include a migration script
- Human review gates must never be removed — this is a safety system

---

## Human Review Requirement

This project has a non-negotiable design constraint: **nothing publishes without human review**. Any contribution that bypasses or weakens the `human_reviewed` gate in the safety_alerts table will not be merged.

---

## Contact

Michael Eisinger — wanderingwithpride.com

For sensitive security issues (not feature requests), email directly rather than opening a public GitHub issue.

---

## Code of Conduct

This project is part of an LGBTQ+ safety platform. Contributors are expected to engage with respect for the communities this platform serves. Contributions that undermine LGBTQ+ safety, introduce bias against queer or trans people, or degrade the integrity of the human review process will be rejected.
