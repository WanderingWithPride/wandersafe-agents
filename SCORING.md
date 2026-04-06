# WanderSafe Destination Safety Scoring

> **Current implementation:** 4-category model (Legal, Safety, Community, Infrastructure).
> A 7-category expansion (adding Healthcare Access, Women's Safety, Digital Privacy Risk) is planned for future releases.
> This document describes the deterministic, rule-based scoring pipeline. No generative AI produces ratings.

# WanderSafe Destination Safety Scoring Algorithm

> Version: 1.0 | Published: March 2026 | License: CC BY 4.0

This document describes the deterministic, rule-based scoring pipeline that produces WanderSafe destination safety ratings. No generative AI produces ratings. All inputs, weights, and thresholds are documented here for public audit.

---

## Three-Mechanism Threat Taxonomy

WanderSafe organizes risk into three distinct failure modes. Mainstream travel advisories typically collapse all three into a single vague warning. WanderSafe treats them as independent axes:

1. **State Erasure** — Government criminalization of same-sex conduct or LGBTQ+ identity. Includes: active criminal statutes, penalty severity (fines, imprisonment, death penalty), documented enforcement patterns, and hostile legal systems (courts, police acting on state authority).

2. **Digital Exploitation** — Law enforcement or hostile actors using technology to surveil, entrap, or expose LGBTQ+ travelers. Includes: documented app-based entrapment operations, state-sponsored digital surveillance, electronic evidence collection, and phone/device searches at borders.

3. **Vigilante Enforcement** — Community violence, family-based harm, or non-state actor threats not sanctioned by government policy. Includes: documented "corrective" violence patterns, community reporting to authorities, and areas where state protection is absent or complicit.

A destination may score well on one axis and poorly on another. Scores are displayed per-mechanism where data supports it.

---

## Data Sources and Input Fields

### Equaldex
- Legal status code: criminalized / decriminalized / no recognition / partnerships / marriage
- Partnership recognition level
- Adoption rights status
- Gender marker change policy
- Anti-discrimination protections (employment, housing, public accommodations)
- Date of last status change (for recency weighting)

### ILGA World State-Sponsored Homophobia Report (annual)
- Existence of criminalizing law (boolean)
- Penalty severity: fine / imprisonment (under 10 years) / imprisonment (10+ years) / life imprisonment / death penalty
- Enforcement level: actively enforced / sporadically enforced / rarely enforced / unenforced

### HRW World Reports (annual)
- Documented incidents in reporting year
- Pattern classification: police-perpetrated / vigilante / state-tolerated vigilante
- Severity level: harassment / arrest / prosecution / conviction / violence
- Digital exploitation documented (boolean)

### US State Department Human Rights Reports
- Country-level advisory level
- LGBTQ+-specific section findings
- Embassy emergency contact (verified)

### Community Reports (Tally form submissions)
- Destination
- Date of travel
- Overall safety rating (1–5)
- Incident category (positive / mixed / incident / unsafe)
- Recency weighting applied (90-day window weighted 2x vs. older reports)

---

## Scoring Logic

```pseudocode
function score_destination(destination):
  base_score = 100  // start at maximum; penalties applied

  // --- Legal Layer (highest weight) ---
  if equaldex.legal_status == "criminalized":
    base_score -= 50
    if ilga.penalty_severity == "death_penalty":
      base_score -= 30
    else if ilga.penalty_severity == "life_imprisonment":
      base_score -= 25
    else if ilga.penalty_severity == "imprisonment_10_plus_years":
      base_score -= 20
    else if ilga.penalty_severity == "imprisonment_under_10_years":
      base_score -= 15
    else if ilga.penalty_severity == "fine_only":
      base_score -= 5
  else if equaldex.legal_status in ["ambiguous", "unclear", "unenforced_law"]:
    base_score -= 10

  // --- Enforcement Layer ---
  if ilga.enforcement_level == "actively_enforced":
    base_score -= 20
  else if ilga.enforcement_level == "sporadically_enforced":
    base_score -= 10
  else if ilga.enforcement_level == "rarely_enforced":
    base_score -= 3

  // --- Digital Exploitation Signal ---
  if hwr.documented_app_entrapment == true:
    base_score -= 15
  else if state_dept.digital_surveillance_warning == true:
    base_score -= 8

  // --- Vigilante Enforcement Signal ---
  if hwr.documented_vigilante_pattern == true:
    base_score -= 10
  if hwr.state_tolerates_vigilante == true:
    base_score -= 5

  // --- Community Signal (recency-weighted, max adjustment ±15) ---
  community_delta = weighted_community_reports(destination, lookback_days=365)
  // community_delta is normalized to range [-15, +15]
  base_score += community_delta

  // Floor at 0
  base_score = max(0, base_score)

  return classify_score(base_score)


function classify_score(score):
  if score >= 75: return "Tier 1 — Safe"
  if score >= 50: return "Tier 2 — Generally Safe"
  if score >= 25: return "Tier 3 — Exercise Caution"
  return "Tier 4 — High Risk"


function weighted_community_reports(destination, lookback_days):
  reports = fetch_approved_reports(destination, lookback_days)
  if len(reports) == 0: return 0

  weighted_sum = 0
  for report in reports:
    age_weight = 2.0 if report.age_days <= 90 else 1.0
    normalized_rating = (report.safety_rating - 3) * 5  // maps 1-5 → -10 to +10
    weighted_sum += normalized_rating * age_weight

  return clamp(weighted_sum / len(reports), -15, 15)
```

---

## Threshold Definitions

| Rating | Score Range | Meaning |
|---|---|---|
| Tier 1 — Safe | 75–100 | Legal protections in place or no criminalizing law; no documented enforcement pattern; community reports generally positive |
| Tier 2 — Generally Safe | 50–74 | Legal ambiguity or legal status OK but significant social risk; sporadic enforcement; mixed community reports |
| Tier 3 — Exercise Caution | 25–49 | Active criminalization with documented enforcement; digital exploitation documented; travelers face real legal exposure |
| Tier 4 — High Risk | 0–24 | Active criminalization + severe penalties (life/death) + active enforcement + documented traveler arrests |

---

## Conflict Resolution Rules

1. **Primary sources beat secondary sources.** Equaldex + ILGA + HRW beat composite indexes (Spartacus, etc.). When sources conflict, the primary source with the most recent data governs scoring.

2. **Recency wins.** If Equaldex shows a law change in the past 6 months, the destination is flagged for immediate re-scoring against all primary sources.

3. **Community reports trigger review, not automatic rescore.** If 3 or more community reports in a 30-day window diverge significantly (±20 points) from the source-derived score, a manual editorial review is queued.

4. **Discrepancy transparency.** When community reports and primary sources conflict, both are published. The displayed score uses primary sources. Community reports appear as the "community experience layer" with a visible note on the discrepancy.

5. **Conservative floor for ambiguous data.** When legal status is unclear or primary source data is unavailable, the destination is scored conservatively (Amber minimum) and displayed with a Data Confidence badge.

---

## Confidence Bands

| Confidence | Data Present | Display |
|---|---|---|
| High | Equaldex + ILGA + HRW chapter + community reports | Standard rating badge |
| Medium | Equaldex + ILGA, no HRW chapter or community reports | Rating badge + "Limited incident data" note |
| Low | Equaldex only, sparse primary sources | Rating badge + "Data Confidence: Limited" badge |
| Insufficient | No reliable primary source | Not published until minimum data threshold met |

---

## Update Cadence

- **Automated (weekly):** Legal News Agent checks Equaldex API + RSS feeds for legal status changes. Flags are queued for human editorial review before any score change is published.
- **Annual:** Each destination re-scored against new ILGA World State-Sponsored Homophobia report (typically published spring).
- **Community-triggered:** 3 or more new reports in 30 days for a single destination triggers a re-review of that destination's scoring.
- **Breaking news:** Human rights incidents surfaced by the News Monitoring Agent trigger immediate manual review for affected destinations.

---

## Methodology Transparency

The full scoring methodology is published at [wanderingwithpride.com/wandersafe-methodology.html](https://wanderingwithpride.com/wandersafe-methodology.html).

Data sources used per destination are cited inline on each destination page. No data is fabricated. Community reports are anonymized before publication. Editorial decisions are made by Wandering With Pride Inc. under its nonprofit editorial independence policy.

See also: [GOVERNANCE.md](GOVERNANCE.md) | [PRIVACY.md](PRIVACY.md)
