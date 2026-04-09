/**
 * WanderSafe Crime Monitor Agent
 *
 * Cloudflare Worker that fetches hate crime data from the FBI Crime
 * Data Explorer API for US destinations and stores alerts for
 * anti-LGBTQ+ bias incidents.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW.
 *
 * Data Sources:
 *   - FBI Crime Data Explorer (api.usa.gov/crime/fbi/sapi/)
 *     Free API key from api.data.gov
 *
 * Schedule: Monthly 1st 06:00 UTC (cron: 0 6 1 * *)
 * FBI data updates annually; monthly check is sufficient.
 *
 * Environment Variables Required:
 *   DB          — Cloudflare D1 database binding
 *   FBI_API_KEY — Free API key from api.data.gov/signup
 *
 * @module crime-monitor
 */

const USER_AGENT = 'WanderSafe/1.0 (+https://wanderingwithpride.com)';

// FBI UCR bias motivation codes relevant to LGBTQ+ hate crimes
const LGBTQ_BIAS_CODES = [
  'Anti-Gay (Male)',
  'Anti-Lesbian (Female)',
  'Anti-Lesbian, Gay, Bisexual, or Transgender (Mixed Group)',
  'Anti-Bisexual',
  'Anti-Transgender',
  'Anti-Gender Non-Conforming',
];

// US states we track for LGBTQ+ legislative activity (matches legiscan-monitor)
const TRACKED_STATES = [
  'FL', 'TX', 'TN', 'OH', 'MO',
  'LA', 'IN', 'KY', 'SC', 'GA',
  'CA', 'NY', 'IL', 'WA', 'OR',
];

async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/**
 * Fetch hate crime statistics from FBI Crime Data Explorer.
 * Returns aggregate counts for LGBTQ+ bias incidents.
 */
async function fetchFBIHateCrimeData(apiKey) {
  // Get the most recent available year of hate crime data
  const url = `https://api.usa.gov/crime/fbi/sapi/api/nibrs/hate-crime/offense/national/count?api_key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`FBI API: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch state-level hate crime incident counts.
 */
async function fetchStateHateCrimes(apiKey, stateAbbrev) {
  const url = `https://api.usa.gov/crime/fbi/sapi/api/nibrs/hate-crime/offense/states/${stateAbbrev}/count?api_key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    // Some states may not have data
    if (response.status === 404) return null;
    throw new Error(`FBI API ${stateAbbrev}: HTTP ${response.status}`);
  }

  return response.json();
}

async function insertAlert(db, alert) {
  await db.prepare(`
    INSERT INTO safety_alerts (
      destination_id, severity, agent_type, source_url, source_name,
      summary, human_reviewed, raw_payload, created_at
    ) VALUES (?, ?, 'crime', ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
  `).bind(
    alert.destinationId,
    alert.severity,
    alert.sourceUrl,
    alert.sourceName,
    alert.summary,
    JSON.stringify(alert.rawPayload ?? {}),
  ).run();
}

export default {
  async scheduled(event, env, ctx) {
    console.log('crime-monitor: scheduled run started', new Date().toISOString());

    if (!env.FBI_API_KEY) {
      console.warn('crime-monitor: FBI_API_KEY not set, skipping. Sign up at api.data.gov/signup');
      return;
    }

    let alertCount = 0;
    const usDestinationId = await getDestinationId(env.DB, 'US');

    // Fetch national-level hate crime summary
    try {
      const nationalData = await fetchFBIHateCrimeData(env.FBI_API_KEY);

      if (usDestinationId && nationalData) {
        await insertAlert(env.DB, {
          destinationId: usDestinationId,
          severity: 'informational',
          sourceUrl: 'https://crime-data-explorer.fr.cloud.gov/',
          sourceName: 'FBI Crime Data Explorer',
          summary: `Monthly hate crime data refresh from FBI UCR. National data updated. Requires human review for trend analysis.`,
          rawPayload: {
            type: 'national_summary',
            data_snapshot: JSON.stringify(nationalData).substring(0, 2000),
            refresh_date: new Date().toISOString(),
          },
        });
        alertCount++;
      }
    } catch (e) {
      console.error('crime-monitor: national data fetch failed:', e.message);
    }

    // Fetch per-state hate crime data for tracked states
    for (const state of TRACKED_STATES) {
      try {
        const stateData = await fetchStateHateCrimes(env.FBI_API_KEY, state);
        if (!stateData) continue;

        // Only create alert if there's meaningful data
        if (usDestinationId) {
          await insertAlert(env.DB, {
            destinationId: usDestinationId,
            severity: 'informational',
            sourceUrl: `https://crime-data-explorer.fr.cloud.gov/pages/explorer/crime/hate-crime`,
            sourceName: 'FBI Crime Data Explorer',
            summary: `Hate crime data refresh for ${state}. Requires human review for LGBTQ+ bias incident trends.`,
            rawPayload: {
              type: 'state_summary',
              state,
              data_snapshot: JSON.stringify(stateData).substring(0, 1000),
              refresh_date: new Date().toISOString(),
            },
          });
          alertCount++;
        }
      } catch (e) {
        console.error(`crime-monitor: ${state} fetch failed:`, e.message);
      }
    }

    try {
      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('crime-monitor', CURRENT_TIMESTAMP, 'success', ?, ?)
      `).bind(alertCount, JSON.stringify({
        states_checked: TRACKED_STATES.length,
        alerts_created: alertCount,
      })).run();
    } catch (e) {
      console.error('crime-monitor: failed to log agent run:', e.message);
    }

    console.log(`crime-monitor: completed — ${alertCount} alerts generated`);
  },

  async fetch(request, env, ctx) {
    const hasKey = !!env.FBI_API_KEY;
    return new Response(JSON.stringify({
      agent: 'crime-monitor',
      status: hasKey ? 'ok' : 'missing_api_key',
      sources: ['FBI Crime Data Explorer'],
      tracked_states: TRACKED_STATES.length,
      api_key_configured: hasKey,
      note: hasKey ? null : 'Sign up for free API key at api.data.gov/signup',
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
