# Contributing to WanderSafe Agents

Thank you for your interest in contributing to the WanderSafe open-source safety intelligence platform for LGBTQ+ travelers. Every contribution — whether a community safety report, a destination request, or a data correction — directly improves the safety resources available to LGBTQ+ travelers worldwide.

## Table of Contents

- [How to Submit a Community Safety Report](#how-to-submit-a-community-safety-report)
- [How to Propose a New Destination](#how-to-propose-a-new-destination)
- [How to Flag Incorrect Data](#how-to-flag-incorrect-data)
- [How the Methodology Was Built](#how-the-methodology-was-built)
- [Code of Conduct](#code-of-conduct)
- [Contact](#contact)

---

## How to Submit a Community Safety Report

Community reports are the human layer of WanderSafe. If you have traveled to a destination and have safety observations, experiences, or ground-truth corrections, we want to hear from you.

**Submit via our community form:** [https://tally.so/r/BzBaLR](https://tally.so/r/BzBaLR)

Please do NOT submit safety reports as GitHub issues — the Tally form is moderated, structured, and routes reports through the appropriate review workflow before any data is published. This protects both reporters and the integrity of the data.

What makes a strong community report:
- Specific location and timeframe (city, month/year)
- Observable conditions, not rumors (what you personally witnessed or experienced)
- Neutral language — the platform is informational, not editorial
- Optional: photos (submitted through the form, reviewed before use)

All reports are reviewed by the WanderSafe team before influencing destination scores or safety assessments.

---

## How to Propose a New Destination

WanderSafe currently covers 20 destinations. If you want to see a destination added, open a GitHub issue using the structured template:

[Open a Destination Request](https://github.com/WanderingWithPride/wandersafe-agents/issues/new?template=destination-request.md)

A strong destination request includes:
- Why the destination matters to LGBTQ+ travelers (volume, unique risk profile, underserved community)
- Any existing legal/rights data you can point to (Equaldex, ILGA reports, news)
- Whether you have personal travel experience there

Destinations are prioritized based on traveler demand, data availability, and alignment with the WanderSafe mission. We cannot guarantee a timeline, but all requests are reviewed.

---

## How to Flag Incorrect Data

WanderSafe monitors legal status, safety conditions, and infrastructure data using automated agents — but automated data can be wrong or outdated. If you spot an error, please report it.

[Open a Data Correction](https://github.com/WanderingWithPride/wandersafe-agents/issues/new?template=data-correction.md)

Data correction issues should include:
- The destination and specific data point that is incorrect
- What the correct information is, with a source if possible (government source, ILGA, Equaldex, credible news)
- Date the correct information took effect, if applicable

Data corrections are reviewed within 7 days and published in the next monitoring cycle.

---

## How the Methodology Was Built

WanderSafe's safety assessments combine multiple data layers:

1. **Legal status data** — sourced from [Equaldex](https://equaldex.com) API and ILGA World reports, covering criminalization, marriage equality, anti-discrimination protections, and gender recognition laws
2. **AI monitoring agents** — four agent types (Legal, News, Event, Photo Content) run on Cloudflare Workers, continuously watching for legislative changes, news events, and safety incidents
3. **Community reports** — moderated submissions from LGBTQ+ travelers with firsthand experience
4. **Personal assessment layer** — destinations where the WanderSafe author has traveled personally include an additional layer of verified ground-truth observation

Full methodology documentation: [wanderingwithpride.com/wandersafe-methodology.html](https://wanderingwithpride.com/wandersafe-methodology.html)

**Important:** The personal assessment layer is not AI-generatable. Only destinations with verified firsthand travel experience receive this designation. Do not propose or contribute fabricated personal assessments.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct, version 2.1](CODE_OF_CONDUCT.md). By participating, you agree to uphold this standard. Violations can be reported to michael.eisinger@wanderingwithpride.com.

---

## Contact

Project maintainer: Michael Eisinger
Email: michael.eisinger@wanderingwithpride.com
Organization: [Wandering With Pride](https://wanderingwithpride.org)

For security disclosures, please email directly rather than opening a public issue.
