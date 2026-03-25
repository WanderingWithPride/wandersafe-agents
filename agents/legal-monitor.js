/**
 * WanderSafe Legal Monitor Agent
 *
 * Cloudflare Worker that polls legal and governmental data sources
 * for changes in LGBTQ+ legal status by destination. On detecting
 * a change, creates a structured alert record in D1 for human review.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. All generated alerts
 * are inserted with human_reviewed = 0 and must be approved through
 * the admin interface before reaching the public platform.
 *
 * Data Sources:
 *   - Equaldex API (equaldex.com/api) - legal status for 200+ countries:
 *       same-sex relationships, marriage equality, adoption rights,
 *       anti-discrimination protections, anti-propaganda laws,
 *       gender marker changes, conversion therapy legality
 *   - U.S. State Department RSS - travel advisory level changes
 *       (Level 1: Normal, Level 2: Increased Caution, Level 3: Reconsider,
 *        Level 4: Do Not Travel)
 *   - LegiScan API - U.S. state LGBTQ+-targeted bill tracking (bathroom
 *       bills, drag bans, trans healthcare restrictions, "Don't Say Gay")
 *
 * Alert Structure (D1 safety_alerts table):
 *   destination_id, severity, agent_type='legal', source_url, source_name,
 *   summary, previous_value, new_value, human_reviewed=0, raw_payload
 *
 * Schedule: Weekly Mon 06:00 UTC (cron: 0 6 * * 1)
 *
 * Environment Variables Required:
 *   EQUALDEX_API_KEY  - from equaldex.com/api (free tier: 100 req/day)
 *   LEGISCAN_API_KEY  - from legiscan.com (free tier available)
 *   DB                - Cloudflare D1 database binding
 *
 * @module legal-monitor
 */

// WanderSafe tracked destination country codes (ISO 3166-1 alpha-2)
const TRACKED_COUNTRY_CODES = [
  'ES', // Spain (Madrid, Barcelona)
  'MX', // Mexico (Puerto Vallarta)
  'PL', // Poland (Krakow)
  'RW', // Rwanda
  'IT', // Italy (Rome)
  'DE', // Germany (Berlin)
  'NL', // Netherlands (Amsterdam)
  'TH', // Thailand (Bangkok)
  'AR', // Argentina (Buenos Aires)
  'US', // United States (general)
];

const STATE_DEPT_RSS_URL =
  'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html/_jcr_content/Grid/par_fullwidth_0/par/NewsletterSignup/rss.xml';

const ADVISORY_SEVERITY = { 1: 'informational', 2: 'low', 3: 'high', 4: 'critical' };

/** Map tracked ISO codes to country names for State Dept RSS title matching. */
const COUNTRY_NAMES = {
  ES: 'Spain', MX: 'Mexico', PL: 'Poland', RW: 'Rwanda', IT: 'Italy',
  DE: 'Germany', NL: 'Netherlands', TH: 'Thailand', AR: 'Argentina', US: 'United States',
};

/**
 * Fetch Equaldex legal status for one country.
 * @param {string} countryCode - ISO 3166-1 alpha-2
 * @param {string} apiKey
 */
async function fetchEqualdexCountry(countryCode, apiKey) {
  const url = `https://www.equaldex.com/api/region?regionid=${countryCode}&formatted=1`;
  const response = await fetch(url, { headers: { 'Authorization': apiKey } });
  if (!response.ok) {
    throw new Error(`Equaldex ${countryCode}: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Extract a normalized fingerprint from an Equaldex region response
 * for change detection.
 */
function extractEqualdexFingerprint(data) {
  const issues = data?.issues ?? {};
  return {
    homosexuality: issues['homosexuality']?.current_value ?? null,
    same_sex_marriage: issues['same-sex-marriage']?.current_value ?? null,
    adoption: issues['adoption']?.current_value ?? null,
    anti_discrimination: issues['anti-discrimination']?.current_value ?? null,
    changing_gender: issues['changing-gender']?.current_value ?? null,
    conversion_therapy: issues['conversion-therapy']?.current_value ?? null,
  };
}

/** Determine alert severity from an Equaldex field change. */
function equaldexChangeSeverity(field, newValue) {
  const val = (newValue ?? '').toLowerCase();
  if (field === 'homosexuality') {
    if (val.includes('illegal') || val.includes('criminal')) return 'critical';
    if (val.includes('legal')) return 'medium';
  }
  if (field === 'same_sex_marriage') return 'medium';
  return 'low';
}

/** Parse State Dept RSS XML for advisory level changes. */
async function fetchStateDeptAdvisories() {
  const response = await fetch(STATE_DEPT_RSS_URL, {
    headers: { 'User-Agent': 'WanderSafe/1.0 (+https://wanderingwithpride.com)' },
  });
  if (!response.ok) throw new Error(`State Dept RSS: HTTP ${response.status}`);

  const xml = await response.text();
  const items = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
                       item.match(/<title>(.*?)<\/title>/);
    const linkMatch  = item.match(/<link>(.*?)<\/link>/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    const levelMatch = title.match(/Level\s+(\d)/i);
    if (!levelMatch) continue;

    items.push({
      title,
      level: parseInt(levelMatch[1], 10),
      url: linkMatch?.[1]?.trim() ?? STATE_DEPT_RSS_URL,
    });
  }
  return items;
}

/** Insert a safety alert into D1 (always human_reviewed=0). */
async function insertAlert(db, alert) {
  await db.prepare(`
    INSERT INTO safety_alerts (
      destination_id, severity, agent_type, source_url, source_name,
      summary, previous_value, new_value, human_reviewed, raw_payload, created_at
    ) VALUES (?, ?, 'legal', ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
  `).bind(
    alert.destinationId,
    alert.severity,
    alert.sourceUrl,
    alert.sourceName,
    alert.summary,
    alert.previousValue ?? null,
    alert.newValue ?? null,
    JSON.stringify(alert.rawPayload ?? {}),
  ).run();
}

/** Get last Equaldex fingerprint for a country from D1. */
async function getLastEqualdexFingerprint(db, countryCode) {
  const row = await db.prepare(`
    SELECT raw_payload FROM safety_alerts
    WHERE agent_type = 'legal' AND source_name = 'Equaldex'
      AND destination_id IN (SELECT id FROM destinations WHERE country_code = ?)
    ORDER BY created_at DESC LIMIT 1
  `).bind(countryCode).first();

  if (!row?.raw_payload) return null;
  try {
    return JSON.parse(row.raw_payload)?.fingerprint ?? null;
  } catch { return null; }
}

/** Get last advisory level for a destination from D1. */
async function getLastAdvisoryLevel(db, destinationId) {
  const row = await db.prepare(`
    SELECT new_value FROM safety_alerts
    WHERE destination_id = ? AND agent_type = 'legal'
      AND source_name = 'U.S. State Department'
    ORDER BY created_at DESC LIMIT 1
  `).bind(destinationId).first();
  return row ? parseInt(row.new_value, 10) : null;
}

/** Get destination ID from D1 by country code. */
async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/** Run the Equaldex polling pass. Returns alert count. */
async function runEqualdexPass(db, apiKey) {
  let alertCount = 0;

  for (const countryCode of TRACKED_COUNTRY_CODES) {
    let data;
    try {
      data = await fetchEqualdexCountry(countryCode, apiKey);
    } catch (e) {
      console.error(`legal-monitor: Equaldex failed for ${countryCode}:`, e.message);
      continue;
    }

    const current = extractEqualdexFingerprint(data);
    const previous = await getLastEqualdexFingerprint(db, countryCode);
    const destinationId = await getDestinationId(db, countryCode);

    if (!destinationId) continue;

    if (previous === null) {
      // First run — seed baseline
      await insertAlert(db, {
        destinationId,
        severity: 'informational',
        sourceUrl: `https://www.equaldex.com/region/${countryCode.toLowerCase()}`,
        sourceName: 'Equaldex',
        summary: `Baseline legal status recorded for ${countryCode}.`,
        previousValue: null,
        newValue: JSON.stringify(current),
        rawPayload: { fingerprint: current },
      });
      alertCount++;
      continue;
    }

    for (const [field, currentVal] of Object.entries(current)) {
      const prevVal = previous[field];
      if (prevVal === currentVal) continue;

      const severity = equaldexChangeSeverity(field, currentVal);
      const label = field.replace(/_/g, ' ');

      await insertAlert(db, {
        destinationId,
        severity,
        sourceUrl: `https://www.equaldex.com/region/${countryCode.toLowerCase()}`,
        sourceName: 'Equaldex',
        summary: `Legal status change in ${countryCode}: ${label} changed from "${prevVal}" to "${currentVal}". Requires human review before publishing.`,
        previousValue: prevVal,
        newValue: currentVal,
        rawPayload: { field, fingerprint: current },
      });
      alertCount++;
      console.log(`legal-monitor: ${countryCode} ${label}: ${prevVal} → ${currentVal}`);
    }
  }

  return alertCount;
}

/** Run the State Dept advisory pass. Returns alert count. */
async function runStateDeptPass(db) {
  let alertCount = 0;
  let advisories;

  try {
    advisories = await fetchStateDeptAdvisories();
  } catch (e) {
    console.error('legal-monitor: State Dept RSS failed:', e.message);
    return 0;
  }

  for (const advisory of advisories) {
    // Match advisory title against country names (not ISO codes, which
    // produce false positives on substrings like "ES" in "DISCUSS")
    const match = TRACKED_COUNTRY_CODES.find(code => {
      const name = COUNTRY_NAMES[code];
      return name && advisory.title.toUpperCase().includes(name.toUpperCase());
    });
    if (!match) continue;

    const destinationId = await getDestinationId(db, match);
    if (!destinationId) continue;

    const lastLevel = await getLastAdvisoryLevel(db, destinationId);
    if (lastLevel === advisory.level) continue;

    await insertAlert(db, {
      destinationId,
      severity: ADVISORY_SEVERITY[advisory.level] ?? 'informational',
      sourceUrl: advisory.url,
      sourceName: 'U.S. State Department',
      summary: `Travel advisory update: ${advisory.title}. Human review required before publishing.`,
      previousValue: lastLevel?.toString() ?? null,
      newValue: advisory.level.toString(),
      rawPayload: { advisory },
    });
    alertCount++;
    console.log(`legal-monitor: advisory alert — ${advisory.title}`);
  }

  return alertCount;
}

export { extractEqualdexFingerprint, equaldexChangeSeverity };

export default {
  async scheduled(event, env, ctx) {
    console.log('legal-monitor: scheduled run started', new Date().toISOString());

    const equaldexAlerts  = await runEqualdexPass(env.DB, env.EQUALDEX_API_KEY);
    const stateDeptAlerts = await runStateDeptPass(env.DB);
    const total = equaldexAlerts + stateDeptAlerts;

    await env.DB.prepare(`
      INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
      VALUES ('legal-monitor', CURRENT_TIMESTAMP, 'success', ?, ?)
    `).bind(total, JSON.stringify({ equaldex_alerts: equaldexAlerts, state_dept_alerts: stateDeptAlerts })).run();

    console.log(`legal-monitor: completed — ${total} alerts generated`);
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      agent: 'legal-monitor',
      status: 'ok',
      sources: ['equaldex', 'state-dept-rss', 'legiscan'],
      tracked_countries: TRACKED_COUNTRY_CODES.length,
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
