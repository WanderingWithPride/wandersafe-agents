# WanderSafe Methodology

**Real-Time LGBTQ+ Travel Safety Intelligence**

Five AI monitoring agents continuously watch legal databases, news feeds, social media, and community reports across 190+ countries. When safety conditions change, the system detects it and flags it for human review before any destination page updates.

Every alert is sourced. Nothing publishes from a black box.

Live methodology page: https://wanderingwithpride.com/wandersafe-methodology.html

---

## What WanderSafe Is

WanderSafe monitors legal status, news and incident reporting, social media signals, digital security conditions, and community-submitted reports. Every destination page reflects the current state of the intelligence — not an annual publication, not a static rating assigned once and left alone.

**Human oversight:** The reviewer is the founder — a gay man with 30 years of international travel experience across 17 countries, 15 years running LGBTQ+ nonprofit programs, and a master's degree in Holocaust and genocide studies.

## What WanderSafe Is Not

- Not a chatbot — does not generate text responses to user questions
- Not an LLM travel advisor — does not produce AI-generated advice
- Not a guarantee — cannot account for race, gender presentation, specific circumstances, neighborhood context, or travel timing
- Not comprehensive for all variables — a "Generally Safe" rating can still present genuine dangers in specific situations

---

## The Five AI Monitoring Agents

### 1. Legal Monitor

**Data sources:**
- Equaldex API — real-time LGBTQ+ legal status for 200+ countries
- TGEU trans rights databases
- HIV criminalization data (hivtravel.org, HIV Justice Network)
- Parliamentary tracking feeds
- Government announcements
- U.S. State Department travel advisory RSS
- LegiScan — U.S. state legislation tracking for LGBTQ+-targeted bills

**Detects changes to:**
- Same-sex criminalization status
- Death penalty applicability
- Anti-propaganda legislation
- Trans documentation requirements
- HIV-related travel restrictions
- U.S. state-level bathroom bills, drag bans, healthcare restrictions for trans youth

**Design principle:** The legal layer is the foundation, but the system is designed specifically around the gap between what is legal and what is safe.

**Schedule:** Weekly Mon 06:00 UTC.

### 2. News Monitor

**Data sources:**
- LGBTQ+-specific media: PinkNews, LGBTQ Nation, The Advocate, Washington Blade, Them, Attitude
- International news via Google News API and NewsAPI.org
- Human rights organizations: Human Rights Watch, Amnesty International, OutRight Action International, ILGA World
- GDELT Project — global event database tracking anti-LGBTQ+ political movements

**Function:** Generates structured safety alerts with severity ratings; cross-references legal status continuously.

**Key signal:** When a country's legal status and news coverage diverge, that divergence is flagged as a high-priority signal.

**Schedule:** Daily 06:00 UTC.

### 3. Social Intelligence Agent

**Data sources:**
- Reddit: r/gaytravellers, r/lgbttravel, country-specific subreddits, r/asktransgender travel threads
- Bluesky (primary LGBTQ+ community text platform)
- Mastodon
- Instagram public accounts and hashtags
- Facebook public LGBTQ+ venue pages and community groups
- Twitter/X keyword monitoring
- Queering the Map community location submissions

**Purpose:** This agent catches what wire services and legal databases do not. A crackdown on a gay bar appears on Instagram before it reaches any news outlet.

**Privacy constraints:** Only public posts are monitored. Individual usernames are not stored. No user profiling — this agent is destination-oriented, not person-oriented.

**Schedule:** Not scheduled (request-driven only).

### 4. Event and Political Climate Monitor

**Tracks:**
- Pride events (cancellations, permit denials, safety warnings, new events)
- Elections with LGBTQ+ implications
- Government formation and transitions
- State-sponsored hostility campaigns
- Diplomatic developments affecting LGBTQ+ rights
- Internet shutdowns (via NetBlocks)
- App surveillance updates (Citizen Lab research)
- Freedom House Freedom on the Net index changes

**Context:** A country hosting World Pride is a different safety environment than the same country six months after a far-right government takes power.

**Schedule:** Weekly Tue 06:00 UTC.

### 5. Community Intelligence Agent

**Process:**
1. Structured intake via Tally form on destination pages
2. AI classification by destination and incident type
3. Audience tag extraction (Bears, trans women, trans men, lesbians, queer POC, older travelers)
4. Validity scoring with transparent reasoning
5. Cross-reference against known legal status, recent news, other reports
6. Human moderation queue — no community report reaches a destination page without approval

**Privacy architecture:**
- Submitter contact information is used only for follow-up on critical reports and is never stored in the database
- Location data is generalized to city level before storage
- No personally identifying information survives into the published record

**Schedule:** On webhook receipt (event-driven).

---

## Human Review Process

Every alert generated by any agent enters a queue with `human_reviewed = false`. A trained human reviewer assesses:

- Source credibility
- Geographic specificity
- Severity classification
- Whether the incident represents a pattern or an outlier
- Whether the alert warrants immediate action or monitoring

Only after approval does anything reach the public platform. This is a non-negotiable design constraint. It is not a performance of rigor — it reflects the reality that automated systems make mistakes, and mistakes in safety intelligence can cause real harm.

---

## The 8 Data Layers Per Destination

Every WanderSafe destination page synthesizes:

1. **Legal status** — Real-time from Equaldex: criminalization, marriage, anti-discrimination, anti-propaganda, trans documentation, HIV restrictions
2. **Safety rating** — Synthesized from all layers; human-reviewed with visible reasoning
3. **Trans traveler section** — Documentation, gender marker policies, hormone medication customs rules, border crossing reports
4. **HIV criminalization** — Laws applying to travelers, pre-arrival information
5. **App safety ratings** — Which apps are safe, which have been used for entrapment, which to delete before customs (sourced to Citizen Lab, HRW, ILGA)
6. **Digital security** — VPN necessity rating, device preparation, border OPSEC, cloud service guidance
7. **Community reports** — Validated submissions with validity ratings and audience tags
8. **Active alerts** — Live warnings with severity ratings and source citations

Additional destination page sections include: emergency protocols, medical provider directory, drug law and harm reduction, social reality layer, transport and airline safety.

---

## The Threat Taxonomy

WanderSafe intelligence is organized around three primary threat mechanisms:

### 1. State-Sponsored Erasure

Formal legal structures that criminalize LGBTQ+ identity or expression: same-sex criminalization laws, death penalty applicability, anti-propaganda statutes, trans documentation barriers, HIV criminalization, border entry restrictions.

These are the most documentable threats. They are also the slowest to change, which makes the delta — when they do change — high-value intelligence.

### 2. Digital Exploitation

Threats that operate through travelers' devices and digital behavior: app-based entrapment (Grindr used by police in at least 15 documented countries), device search at border (photos, apps, messaging history), surveillance of dating app usage, mandatory SIM registration tied to national ID.

This layer is monitored via Citizen Lab, NetBlocks, Freedom House, and Human Rights Watch. It is the fastest-moving threat surface — a country that was safe for app usage last year may not be now.

### 3. Vigilante Enforcement

Violence, harassment, and coercion operating outside formal legal systems: organized anti-LGBTQ+ groups, entrapment schemes not run by police, blackmail operations, neighborhood-level hostility that does not result in police reports.

This layer is hardest to document from institutional sources. It is the primary reason the social intelligence and community report layers exist — it surfaces first in community channels.

---

## Community Report Validation

Community reports receive a validity score (0.0–1.0) based on:

- **Specificity**: Does the report include a time, location, and incident type? Vague reports score lower.
- **Consistency**: Is the report consistent with known conditions? A report of severe violence in a country with strong legal protections is not necessarily false — but it warrants closer scrutiny.
- **Corroboration**: Are there other recent reports describing similar conditions?
- **Coherence**: Is the internal logic of the report consistent? Contradictory details lower the score.

Validity score is shown to destination page visitors alongside the report — it is not a black-box filter. A low-validity report that is published carries a note explaining why it was published despite uncertainty (typically: the incident type is severe enough that it warrants visibility even if not fully corroborated).

---

## Privacy Architecture

- Community report submitter contact information is collected only for follow-up on critical incidents; it is never stored in the database after that window
- Individual social media usernames are never stored; only signal content and canonical source URLs
- Location data in community reports is generalized to city/neighborhood level
- Subscriber email addresses are stored as SHA-256 hashes for deduplication; plaintext emails are used only for delivery and are not retained
- No personal profiles are built; the system is destination-intelligence-oriented, not traveler-tracking-oriented
- WanderSafe Circles (in-country contacts) use end-to-end encrypted communications that are never stored in readable form on servers

---

## The Rating Scale

### Safe

Strong legal protections, welcoming social climate, recent news shows no significant deterioration, and community reports are consistently positive. LGBTQ+ travelers can generally move, be visible, and engage with local queer communities without elevated concern.

### Generally Safe

Legal framework is positive or neutral, social acceptance is moderate to high in most contexts, and no major recent incidents. Some caveats apply: regional variation, specific contexts, or gaps between law and social norms.

### Exercise Caution

Legal protections are limited or absent, or there is a meaningful gap between legal status and enforcement or social climate. Recent news or community reports indicate elevated risk in certain contexts. Traveling requires more deliberate planning, discretion in public, and awareness of which spaces are safer than others. Not "don't go."

### High Risk

Same-sex relations are criminalized, or there is active state enforcement, documented violence, or an environment where LGBTQ+ travelers face a meaningful probability of harm. Travel here requires serious risk assessment.

---

## Limitations

### Law vs. Reality

Legal equality does not guarantee social safety. Several European countries with full marriage equality have seen sharp rises in anti-LGBTQ+ violence. Some destinations with no formal legal recognition have established queer communities that are well-known and relatively undisturbed.

### Regional Variation

Country-level ratings simplify complexity. Capital cities may have thriving queer neighborhoods while rural areas are less welcoming.

### Recency Bias

Ratings reflect conditions as of the date noted. Laws, governments, and political climates shift quickly. Always check recent sources before travel.

### Identity Variation

Risk is not uniform across LGBTQ+ identities. Transgender travelers — particularly trans women and nonbinary people whose presentation is visibly gender-nonconforming — face different and often greater risks than cisgender gay men in many destinations. Queer people of color face intersectional risks. Couples traveling together are more visible than solo travelers.

### Source Limitations

Community data is crowdsourced and self-selected. People who had bad experiences may not report them. English-language sources are overrepresented.

---

## Open Source Commitment

The methodology, agent architecture, and D1 database schema are released as open infrastructure under MIT license.

A Kenyan trans rights organization, a Filipino LGBTQ+ student group, or a Brazilian activist collective should be able to run this pipeline for their own community — monitoring their own country's laws, local news, and community reports — without asking permission or paying a subscription.

Agent code: MIT License
Safety intelligence data published through the platform: CC BY 4.0 (share with attribution)
Community report content: anonymized before publication; no PII retained

Repository: https://github.com/WanderingWithPride/wandersafe-agents

---

## Organizational Context

WanderSafe is a product of Eisinger Holdings LLC, connected to Wandering With Pride Inc., a 501(c)(3) nonprofit LGBTQ+ scholarship program. Scholars and members of the nonprofit receive free full access. The platform's open infrastructure release is part of an organizational commitment to LGBTQ+ communities beyond the US.

---

## Final Note

WanderSafe is a starting point, not a guarantee. Laws change. Enforcement varies. Your identity, your presentation, and your specific circumstances all shape the reality on the ground. This tool gives you the most current intelligence available. Always do your own research and trust your judgment when you are there.
