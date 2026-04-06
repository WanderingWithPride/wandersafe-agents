# WanderSafe Reporter Privacy

This document describes how WanderSafe protects community safety report contributors.

## What Happens When You Submit a Report

1. You submit a report through the [community report form](https://tally.so/r/BzBaLR)
2. Tally.so processes the form submission ([Tally privacy policy](https://tally.so/help/privacy-policy))
3. Our Community Validator receives the submission via webhook
4. **Your name and email are extracted** for potential follow-up on critical reports only
5. **Your name and email are NOT stored** in the WanderSafe database
6. The report text is anonymized before database insertion
7. AI validation (Claude Haiku) scores report plausibility -- it receives only the anonymized text, never your identity
8. A human reviewer sees the anonymized report -- they do not see your identity unless follow-up is needed for a critical safety issue
9. Published reports show destination, date, and content only -- never reporter identity

## What We Do NOT Store

- Reporter names
- Reporter email addresses (used only for one-time follow-up, then deleted)
- IP addresses
- Device information
- Location data at time of submission

## Threat Model for Reporters in Hostile Jurisdictions

We recognize that submitting a community report about LGBTQ+ safety in a country that criminalizes homosexuality carries real risk. Our protections:

- **Reporter identity is never published**, even if you consent to attribution
- **Reports do not contain IP addresses** in the database
- **No geolocation** is collected or stored
- **We recommend submitting reports after leaving the destination**, not while you are there
- **We recommend using a VPN** when submitting reports about high-risk destinations
- **The submission form is hosted by Tally.so** (Belgium, EU), not on our infrastructure

## Data Retention

- **Anonymized report content**: retained indefinitely (safety intelligence archive)
- **Reporter contact info**: deleted after follow-up or 30 days, whichever is sooner
- **AI validation logs**: 90 days

## Your Rights

You may request removal of your community report at any time by emailing michael@wanderingwithpride.com. We will remove it within 30 days.

## Questions

Contact: michael@wanderingwithpride.com
