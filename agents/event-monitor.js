/**
 * WanderSafe Event Monitor Agent
 *
 * Cloudflare Worker that monitors U.S. State Department travel advisories
 * and Equaldex legal status changes for events that could affect LGBTQ+
 * safety ratings. Also checks news feeds for Pride event cancellations
 * and bans.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. All generated alerts
 * are inserted with human_reviewed = 0 and must be approved
 * through the admin interface before reaching the public platform.
 *
 * Data Sources:
 *   - U.S. State Department travel advisory RSS
 *   - Equaldex API (legal status change detection)
 *   - RSS keyword search for Pride cancellations/bans
 *
 * Schedule: Weekly Tue 06:00 UTC (cron: 0 6 * * 2)
 *
 * Environment Variables Required:
 *   DB               — Cloudflare D1 database binding
 *   EQUALDEX_API_KEY — Equaldex API key for legal status queries
 *
 * @module event-monitor
 */

const STATE_DEPT_RSS_URL =
  'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html/_jcr_content/Grid/par_fullwidth_0/par/NewsletterSignup/rss.xml';

/** Map advisory levels to severity. */
const ADVISORY_SEVERITY = {
  1: 'informational',
  2: 'low',
  3: 'high',
  4: 'critical',
};

/** Tracked country codes and their names for matching. */
const TRACKED_COUNTRIES = {
  'IL': { name: 'Israel',      keywords: ['israel', 'tel aviv'] },
  'TR': { name: 'Turkey',      keywords: ['turkey', 'istanbul', 'turkiye'] },
  'AE': { name: 'UAE',         keywords: ['uae', 'emirates', 'dubai', 'abu dhabi'] },
  'JM': { name: 'Jamaica',     keywords: ['jamaica'] },
  'ID': { name: 'Indonesia',   keywords: ['indonesia', 'bali'] },
  'IN': { name: 'India',       keywords: ['india', 'mumbai'] },
  'SG': { name: 'Singapore',   keywords: ['singapore'] },
  'MA': { name: 'Morocco',     keywords: ['morocco', 'marrakech'] },
  'CU': { name: 'Cuba',        keywords: ['cuba', 'havana'] },
  'TH': { name: 'Thailand',    keywords: ['thailand', 'bangkok'] },
  'UG': { name: 'Uganda',      keywords: ['uganda', 'kampala'] },
  'KE': { name: 'Kenya',       keywords: ['kenya', 'nairobi'] },
  'RU': { name: 'Russia',      keywords: ['russia', 'moscow'] },
  'PL': { name: 'Poland',      keywords: ['poland', 'warsaw', 'krakow'] },
  'HU': { name: 'Hungary',     keywords: ['hungary', 'budapest'] },
  'GH': { name: 'Ghana',       keywords: ['ghana', 'accra'] },
  'NG': { name: 'Nigeria',     keywords: ['nigeria', 'lagos'] },
  'EG': { name: 'Egypt',       keywords: ['egypt', 'cairo'] },
  'SA': { name: 'Saudi Arabia', keywords: ['saudi arabia', 'saudi', 'riyadh'] },
  'ES': { name: 'Spain',       keywords: ['spain', 'madrid', 'barcelona'] },
  'MX': { name: 'Mexico',      keywords: ['mexico', 'puerto vallarta'] },
  'DE': { name: 'Germany',     keywords: ['germany', 'berlin'] },
  'NL': { name: 'Netherlands', keywords: ['netherlands', 'amsterdam'] },
  'AR': { name: 'Argentina',   keywords: ['argentina', 'buenos aires'] },
};

/** Equaldex fields that matter for LGBTQ+ safety and their severity when they change. */
const EQUALDEX_CRITICAL_FIELDS = {
  homosexuality: { negative: 'critical', positive: 'medium' },
  'same-sex-marriage': { negative: 'medium', positive: 'medium' },
  adoption: { negative: 'low', positive: 'low' },
  'anti-discrimination': { negative: 'medium', positive: 'low' },
  'changing-gender': { negative: 'medium', positive: 'low' },
  'conversion-therapy': { negative: 'high', positive: 'low' },
};

/** Pride-related keywords for cancellation/ban detection. */
const PRIDE_CANCEL_KEYWORDS = [
  'pride banned', 'pride cancelled', 'pride canceled',
  'pride march banned', 'pride parade banned', 'pride festival banned',
  'pride permit denied', 'pride event cancelled', 'pride event canceled',
  'pride prohibited', 'lgbtq event banned', 'gay parade banned',
];

/** RSS feeds to check for Pride cancellation news. */
const NEWS_FEEDS_FOR_PRIDE = [
  { name: 'PinkNews', url: 'https://www.pinknews.co.uk/feed/' },
  { name: 'LGBTQ Nation', url: 'https://www.lgbtqnation.com/feed/' },
  { name: 'Openly (Reuters)', url: 'https://www.openlynews.com/feed/' },
];

/**
 * Generate SHA-256 hash.
 */
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get destination ID from D1 by country code.
 */
async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/**
 * Insert a safety alert into D1.
 */
async function insertAlert(db, alert) {
  await db.prepare(`
    INSERT INTO safety_alerts (
      destination_id, severity, agent_type, source_url, source_name,
      summary, previous_value, new_value, human_reviewed, raw_payload, created_at
    ) VALUES (?, ?, 'event', ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
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

/**
 * Check dedup by hash in raw_payload.
 */
async function isDuplicate(db, hash) {
  const row = await db.prepare(
    "SELECT id FROM safety_alerts WHERE agent_type = 'event' AND raw_payload LIKE ?"
  ).bind(`%"dedup_hash":"${hash}"%`).first();
  return !!row;
}

// ============================================================
// State Dept Advisory Monitoring
// ============================================================

/**
 * Parse State Dept RSS XML for advisory level changes.
 */
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

/**
 * Get last advisory level for a destination from D1.
 */
async function getLastAdvisoryLevel(db, destinationId) {
  const row = await db.prepare(`
    SELECT new_value FROM safety_alerts
    WHERE destination_id = ? AND agent_type IN ('event', 'legal')
      AND source_name = 'U.S. State Department'
    ORDER BY created_at DESC LIMIT 1
  `).bind(destinationId).first();
  return row ? parseInt(row.new_value, 10) : null;
}

/**
 * Run State Dept advisory pass.
 */
async function runStateDeptPass(db) {
  let alertCount = 0;
  let advisories;

  try {
    advisories = await fetchStateDeptAdvisories();
  } catch (e) {
    console.error('event-monitor: State Dept RSS failed:', e.message);
    return 0;
  }

  for (const advisory of advisories) {
    const titleUpper = advisory.title.toUpperCase();

    const matchedCode = Object.keys(TRACKED_COUNTRIES).find(code => {
      const country = TRACKED_COUNTRIES[code];
      return country.keywords.some(kw => titleUpper.includes(kw.toUpperCase()));
    });

    if (!matchedCode) continue;

    const destinationId = await getDestinationId(db, matchedCode);
    if (!destinationId) continue;

    const lastLevel = await getLastAdvisoryLevel(db, destinationId);
    if (lastLevel === advisory.level) continue;

    // Determine if this is an escalation or de-escalation
    const direction = lastLevel !== null && advisory.level > lastLevel ? 'escalated' : 'updated';
    const severity = ADVISORY_SEVERITY[advisory.level] ?? 'informational';

    try {
      await insertAlert(db, {
        destinationId,
        severity,
        sourceUrl: advisory.url,
        sourceName: 'U.S. State Department',
        summary: `Travel advisory ${direction}: ${advisory.title}. ${
          lastLevel !== null ? `Changed from Level ${lastLevel} to Level ${advisory.level}.` : `Now at Level ${advisory.level}.`
        } Requires human review before publishing.`,
        previousValue: lastLevel?.toString() ?? null,
        newValue: advisory.level.toString(),
        rawPayload: {
          dedup_hash: await sha256(`statedept-${matchedCode}-level-${advisory.level}`),
          advisory,
          direction,
        },
      });
      alertCount++;
      console.log(`event-monitor: advisory — ${advisory.title}`);
    } catch (e) {
      console.error(`event-monitor: failed to insert advisory alert for ${matchedCode}:`, e.message);
    }
  }

  return alertCount;
}

// ============================================================
// Equaldex Legal Change Detection
// ============================================================

/**
 * Fetch Equaldex legal status for a country and extract key fields.
 */
async function fetchEqualdexStatus(countryCode, apiKey) {
  const url = `https://www.equaldex.com/api/region?regionid=${countryCode}&formatted=1`;
  const response = await fetch(url, { headers: { 'Authorization': apiKey } });
  if (!response.ok) throw new Error(`Equaldex ${countryCode}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Extract a normalized status object from Equaldex response.
 */
function extractLegalStatus(data) {
  const issues = data?.issues ?? {};
  const status = {};
  for (const field of Object.keys(EQUALDEX_CRITICAL_FIELDS)) {
    status[field] = issues[field]?.current_value ?? null;
  }
  return status;
}

/**
 * Get last known Equaldex status for a country from D1 (stored by event-monitor).
 */
async function getLastEqualdexStatus(db, countryCode) {
  const row = await db.prepare(`
    SELECT raw_payload FROM safety_alerts
    WHERE agent_type = 'event' AND source_name = 'Equaldex'
      AND destination_id IN (SELECT id FROM destinations WHERE country_code = ?)
    ORDER BY created_at DESC LIMIT 1
  `).bind(countryCode).first();

  if (!row?.raw_payload) return null;
  try {
    return JSON.parse(row.raw_payload)?.legal_status ?? null;
  } catch { return null; }
}

/**
 * Determine severity of an Equaldex field change.
 */
function equaldexChangeSeverity(field, oldValue, newValue) {
  const config = EQUALDEX_CRITICAL_FIELDS[field];
  if (!config) return 'low';

  const newLower = (newValue ?? '').toLowerCase();

  // Negative changes (rights lost, criminalization)
  if (newLower.includes('illegal') || newLower.includes('criminal') ||
      newLower.includes('death') || newLower.includes('none') ||
      newLower.includes('imprisonment')) {
    return config.negative;
  }

  // Positive changes (rights gained)
  if (newLower.includes('legal') || newLower.includes('banned') ||
      newLower.includes('recognized') || newLower.includes('both')) {
    return config.positive;
  }

  return 'low';
}

/**
 * Run Equaldex change detection pass.
 */
async function runEqualdexPass(db, apiKey) {
  if (!apiKey) {
    console.warn('event-monitor: EQUALDEX_API_KEY not set, skipping Equaldex pass');
    return 0;
  }

  let alertCount = 0;

  for (const countryCode of Object.keys(TRACKED_COUNTRIES)) {
    let data;
    try {
      data = await fetchEqualdexStatus(countryCode, apiKey);
    } catch (e) {
      console.error(`event-monitor: Equaldex failed for ${countryCode}:`, e.message);
      continue;
    }

    const currentStatus = extractLegalStatus(data);
    const previousStatus = await getLastEqualdexStatus(db, countryCode);
    const destinationId = await getDestinationId(db, countryCode);

    if (!destinationId) continue;

    if (previousStatus === null) {
      // First run — seed baseline
      try {
        await insertAlert(db, {
          destinationId,
          severity: 'informational',
          sourceUrl: `https://www.equaldex.com/region/${countryCode.toLowerCase()}`,
          sourceName: 'Equaldex',
          summary: `Baseline legal status recorded for ${TRACKED_COUNTRIES[countryCode].name}.`,
          previousValue: null,
          newValue: JSON.stringify(currentStatus),
          rawPayload: { legal_status: currentStatus },
        });
        alertCount++;
      } catch (e) {
        console.error(`event-monitor: failed to insert Equaldex baseline for ${countryCode}:`, e.message);
      }
      continue;
    }

    // Compare each field for changes
    for (const [field, currentVal] of Object.entries(currentStatus)) {
      const prevVal = previousStatus[field];
      if (prevVal === currentVal) continue;

      const severity = equaldexChangeSeverity(field, prevVal, currentVal);
      const label = field.replace(/-/g, ' ');

      try {
        await insertAlert(db, {
          destinationId,
          severity,
          sourceUrl: `https://www.equaldex.com/region/${countryCode.toLowerCase()}`,
          sourceName: 'Equaldex',
          summary: `Legal status change in ${TRACKED_COUNTRIES[countryCode].name}: ${label} changed from "${prevVal ?? 'unknown'}" to "${currentVal}". Requires human review before publishing.`,
          previousValue: prevVal,
          newValue: currentVal,
          rawPayload: { field, legal_status: currentStatus },
        });
        alertCount++;
        console.log(`event-monitor: ${countryCode} ${label}: ${prevVal} -> ${currentVal}`);
      } catch (e) {
        console.error(`event-monitor: failed to insert Equaldex alert for ${countryCode}:`, e.message);
      }
    }
  }

  return alertCount;
}

// ============================================================
// Pride Cancellation / Ban Detection
// ============================================================

/**
 * Parse RSS items from a feed.
 */
function parseRSSItems(xml) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
                       item.match(/<title>(.*?)<\/title>/);
    const descMatch  = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ??
                       item.match(/<description>([\s\S]*?)<\/description>/);
    const linkMatch  = item.match(/<link>(.*?)<\/link>/);

    if (!titleMatch) continue;

    items.push({
      title: titleMatch[1].trim().replace(/<[^>]+>/g, ''),
      description: (descMatch?.[1] ?? '').trim().replace(/<[^>]+>/g, ''),
      link: linkMatch?.[1]?.trim() ?? '',
    });
  }
  return items;
}

/**
 * Check RSS feeds for Pride cancellations/bans.
 */
async function runPrideCancellationPass(db) {
  let alertCount = 0;

  for (const feed of NEWS_FEEDS_FOR_PRIDE) {
    let xml;
    try {
      const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'WanderSafe/1.0 (+https://wanderingwithpride.com)' },
      });
      if (!response.ok) continue;
      xml = await response.text();
    } catch (e) {
      console.error(`event-monitor: Pride check — ${feed.name} failed:`, e.message);
      continue;
    }

    const items = parseRSSItems(xml);

    for (const item of items) {
      const combinedText = `${item.title} ${item.description}`.toLowerCase();

      // Check if any Pride cancellation keyword matches
      const hasPrideKeyword = PRIDE_CANCEL_KEYWORDS.some(kw => combinedText.includes(kw));
      if (!hasPrideKeyword) continue;

      // Try to match a destination
      const matchedCountries = [];
      for (const [code, country] of Object.entries(TRACKED_COUNTRIES)) {
        if (country.keywords.some(kw => combinedText.includes(kw))) {
          matchedCountries.push(code);
        }
      }

      if (matchedCountries.length === 0) continue;

      const dedupHash = await sha256(item.link || item.title);
      if (await isDuplicate(db, dedupHash)) continue;

      for (const countryCode of matchedCountries) {
        const destinationId = await getDestinationId(db, countryCode);
        if (!destinationId) continue;

        try {
          await insertAlert(db, {
            destinationId,
            severity: 'high',
            sourceUrl: item.link,
            sourceName: feed.name,
            summary: `Pride event cancellation/ban detected: ${item.title}. Requires human review before publishing.`,
            previousValue: null,
            newValue: null,
            rawPayload: {
              dedup_hash: dedupHash,
              title: item.title,
              description: item.description.substring(0, 500),
              feed_name: feed.name,
              detection_type: 'pride_cancellation',
            },
          });
          alertCount++;
          console.log(`event-monitor: Pride cancellation — ${item.title}`);
        } catch (e) {
          console.error(`event-monitor: failed to insert Pride alert for ${countryCode}:`, e.message);
        }
      }
    }
  }

  return alertCount;
}

// ============================================================
// Exports
// ============================================================

export default {
  async scheduled(event, env, ctx) {
    console.log('event-monitor: scheduled run started', new Date().toISOString());

    const stateDeptAlerts = await runStateDeptPass(env.DB);
    const equaldexAlerts = await runEqualdexPass(env.DB, env.EQUALDEX_API_KEY);
    const prideAlerts = await runPrideCancellationPass(env.DB);

    const total = stateDeptAlerts + equaldexAlerts + prideAlerts;

    try {
      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('event-monitor', CURRENT_TIMESTAMP, 'success', ?, ?)
      `).bind(total, JSON.stringify({
        state_dept_alerts: stateDeptAlerts,
        equaldex_alerts: equaldexAlerts,
        pride_alerts: prideAlerts,
      })).run();
    } catch (e) {
      console.error('event-monitor: failed to log agent run:', e.message);
    }

    console.log(`event-monitor: completed — ${total} alerts generated`);
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      agent: 'event-monitor',
      status: 'ok',
      sources: ['U.S. State Department', 'Equaldex', 'Pride cancellation RSS'],
      tracked_countries: Object.keys(TRACKED_COUNTRIES).length,
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
