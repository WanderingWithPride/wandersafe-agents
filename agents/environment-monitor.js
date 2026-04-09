/**
 * WanderSafe Environment Monitor Agent
 *
 * Cloudflare Worker that monitors weather alerts, seismic activity, and
 * natural disasters near tracked destinations using free government APIs.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. All generated alerts
 * are inserted with human_reviewed = 0.
 *
 * Data Sources:
 *   - NOAA/NWS (api.weather.gov) — active weather alerts by coordinates
 *   - USGS (earthquake.usgs.gov) — significant earthquakes worldwide
 *   - GDACS (gdacs.org) — global disaster alerts (floods, cyclones, volcanoes)
 *
 * Schedule: Daily 08:00 UTC (cron: 0 8 * * *)
 *
 * Environment Variables Required:
 *   DB — Cloudflare D1 database binding
 *
 * @module environment-monitor
 */

// Tracked destinations with coordinates for proximity checks
const DESTINATIONS = [
  { code: 'ES', slug: 'ES-madrid', lat: 40.4168, lon: -3.7038, name: 'Madrid' },
  { code: 'MX', slug: 'MX-puerto-vallarta', lat: 20.6534, lon: -105.2253, name: 'Puerto Vallarta' },
  { code: 'PL', slug: 'PL-krakow', lat: 50.0647, lon: 19.9450, name: 'Krakow' },
  { code: 'IT', slug: 'IT-rome', lat: 41.9028, lon: 12.4964, name: 'Rome' },
  { code: 'DE', slug: 'DE-berlin', lat: 52.5200, lon: 13.4050, name: 'Berlin' },
  { code: 'NL', slug: 'NL-amsterdam', lat: 52.3676, lon: 4.9041, name: 'Amsterdam' },
  { code: 'TH', slug: 'TH-bangkok', lat: 13.7563, lon: 100.5018, name: 'Bangkok' },
  { code: 'AR', slug: 'AR-buenos-aires', lat: -34.6037, lon: -58.3816, name: 'Buenos Aires' },
  { code: 'JP', slug: 'JP-tokyo', lat: 35.6762, lon: 139.6503, name: 'Tokyo' },
  { code: 'ZA', slug: 'ZA-cape-town', lat: -33.9249, lon: 18.4241, name: 'Cape Town' },
  { code: 'IS', slug: 'IS-reykjavik', lat: 64.1466, lon: -21.9426, name: 'Reykjavik' },
  { code: 'PT', slug: 'PT-lisbon', lat: 38.7223, lon: -9.1393, name: 'Lisbon' },
  { code: 'CZ', slug: 'CZ-prague', lat: 50.0755, lon: 14.4378, name: 'Prague' },
];

const USER_AGENT = 'WanderSafe/1.0 (+https://wanderingwithpride.com)';

/**
 * Haversine distance between two points in kilometers.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sleep helper for rate limiting. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Get destination ID from D1 by country code. */
async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/** Generate SHA-256 dedup hash. */
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Check if environment alert already exists (dedup). */
async function isDuplicate(db, hash) {
  const row = await db.prepare(
    "SELECT id FROM environment_alerts WHERE summary LIKE ?"
  ).bind(`%${hash.substring(0, 16)}%`).first();
  return !!row;
}

/** Insert environment alert into D1. */
async function insertEnvAlert(db, alert) {
  await db.prepare(`
    INSERT INTO environment_alerts (
      destination_id, alert_type, severity, source, summary,
      coordinates, expires_at, created_at, human_reviewed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
  `).bind(
    alert.destinationId,
    alert.alertType,
    alert.severity,
    alert.source,
    alert.summary,
    JSON.stringify(alert.coordinates),
    alert.expiresAt ?? null,
  ).run();
}

// ---------------------------------------------------------------------------
// NOAA/NWS Weather Alerts
// ---------------------------------------------------------------------------

/**
 * Fetch active weather alerts near a coordinate from NOAA.
 * Note: NOAA only covers US territories. Non-US destinations will 404.
 */
async function fetchNOAAAlerts(lat, lon) {
  const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}&limit=5`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/geo+json' },
  });
  if (response.status === 404) return []; // Non-US location
  if (!response.ok) throw new Error(`NOAA: HTTP ${response.status}`);
  const data = await response.json();
  return data.features ?? [];
}

/** Map NOAA severity to our severity scale. */
function noaaSeverity(nwsSeverity) {
  const map = { Extreme: 'critical', Severe: 'high', Moderate: 'medium', Minor: 'low' };
  return map[nwsSeverity] ?? 'informational';
}

async function runNOAAPass(db) {
  let alertCount = 0;
  // NOAA only works for US-adjacent. Check all destinations but expect 404 for non-US.
  for (const dest of DESTINATIONS) {
    try {
      const alerts = await fetchNOAAAlerts(dest.lat, dest.lon);
      for (const feature of alerts) {
        const props = feature.properties;
        const dedupKey = props.id ?? `${dest.code}-${props.event}-${props.onset}`;
        const hash = await sha256(dedupKey);
        if (await isDuplicate(db, hash)) continue;

        const destinationId = await getDestinationId(db, dest.code);
        if (!destinationId) continue;

        await insertEnvAlert(db, {
          destinationId,
          alertType: 'weather',
          severity: noaaSeverity(props.severity),
          source: 'NOAA/NWS',
          summary: `[${hash.substring(0, 16)}] ${props.event}: ${props.headline ?? props.description?.substring(0, 200)}. ${dest.name}.`,
          coordinates: { lat: dest.lat, lon: dest.lon },
          expiresAt: props.expires ?? null,
        });
        alertCount++;
      }
    } catch (e) {
      console.error(`environment-monitor: NOAA failed for ${dest.name}:`, e.message);
    }
    await sleep(2000); // Respect NOAA rate limit (1 req/30s generous)
  }
  return alertCount;
}

// ---------------------------------------------------------------------------
// USGS Earthquakes
// ---------------------------------------------------------------------------

async function runUSGSPass(db) {
  let alertCount = 0;
  const PROXIMITY_KM = 500;

  let data;
  try {
    const response = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (!response.ok) throw new Error(`USGS: HTTP ${response.status}`);
    data = await response.json();
  } catch (e) {
    console.error('environment-monitor: USGS fetch failed:', e.message);
    return 0;
  }

  for (const feature of (data.features ?? [])) {
    const [lon, lat, depth] = feature.geometry?.coordinates ?? [];
    const props = feature.properties;
    if (!lat || !lon) continue;

    for (const dest of DESTINATIONS) {
      const distance = haversineKm(dest.lat, dest.lon, lat, lon);
      if (distance > PROXIMITY_KM) continue;

      const dedupKey = `usgs-${feature.id}-${dest.code}`;
      const hash = await sha256(dedupKey);
      if (await isDuplicate(db, hash)) continue;

      const destinationId = await getDestinationId(db, dest.code);
      if (!destinationId) continue;

      const mag = props.mag ?? 0;
      const severity = mag >= 7 ? 'critical' : mag >= 6 ? 'high' : mag >= 5 ? 'medium' : 'low';

      await insertEnvAlert(db, {
        destinationId,
        alertType: 'earthquake',
        severity,
        source: 'USGS',
        summary: `[${hash.substring(0, 16)}] M${mag.toFixed(1)} earthquake ${Math.round(distance)}km from ${dest.name}: ${props.place ?? 'unknown location'}. Depth: ${depth?.toFixed(0) ?? '?'}km.`,
        coordinates: { lat, lon, depth },
        expiresAt: null,
      });
      alertCount++;
      console.log(`environment-monitor: USGS — M${mag.toFixed(1)} near ${dest.name} (${Math.round(distance)}km)`);
    }
  }
  return alertCount;
}

// ---------------------------------------------------------------------------
// GDACS Disasters
// ---------------------------------------------------------------------------

async function runGDACSPass(db) {
  let alertCount = 0;
  const PROXIMITY_KM = 500;

  let xml;
  try {
    const response = await fetch(
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?pagenumber=1&pagesize=50',
      { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/xml' } }
    );
    if (!response.ok) throw new Error(`GDACS: HTTP ${response.status}`);
    xml = await response.text();
  } catch (e) {
    console.error('environment-monitor: GDACS fetch failed:', e.message);
    return 0;
  }

  // Parse GDACS XML events (simple regex -- no external XML parser needed)
  const events = [];
  for (const match of xml.matchAll(/<gdacs:event\s([\s\S]*?)\/>/g)) {
    const attrs = match[1];
    const get = (name) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*?)"`));
      return m?.[1] ?? null;
    };
    events.push({
      eventtype: get('eventtype'),
      eventid: get('eventid'),
      severity: get('severity'),
      name: get('name'),
      lat: parseFloat(get('lat')),
      lon: parseFloat(get('lon')),
      alertlevel: get('alertlevel'),
    });
  }

  for (const event of events) {
    if (!event.lat || !event.lon || isNaN(event.lat)) continue;

    for (const dest of DESTINATIONS) {
      const distance = haversineKm(dest.lat, dest.lon, event.lat, event.lon);
      if (distance > PROXIMITY_KM) continue;

      const dedupKey = `gdacs-${event.eventtype}-${event.eventid}-${dest.code}`;
      const hash = await sha256(dedupKey);
      if (await isDuplicate(db, hash)) continue;

      const destinationId = await getDestinationId(db, dest.code);
      if (!destinationId) continue;

      const severityMap = { Red: 'critical', Orange: 'high', Green: 'medium' };
      const severity = severityMap[event.alertlevel] ?? 'low';

      const typeLabels = { EQ: 'Earthquake', FL: 'Flood', TC: 'Tropical Cyclone', VO: 'Volcano' };
      const typeLabel = typeLabels[event.eventtype] ?? event.eventtype;

      await insertEnvAlert(db, {
        destinationId,
        alertType: event.eventtype?.toLowerCase() ?? 'disaster',
        severity,
        source: 'GDACS',
        summary: `[${hash.substring(0, 16)}] ${typeLabel} alert (${event.alertlevel ?? 'unknown'}) ${Math.round(distance)}km from ${dest.name}: ${event.name ?? 'unnamed event'}.`,
        coordinates: { lat: event.lat, lon: event.lon },
        expiresAt: null,
      });
      alertCount++;
      console.log(`environment-monitor: GDACS — ${typeLabel} near ${dest.name} (${event.alertlevel})`);
    }
  }
  return alertCount;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default {
  async scheduled(event, env, ctx) {
    console.log('environment-monitor: scheduled run started', new Date().toISOString());

    // Ensure table exists
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS environment_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          destination_id TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          source TEXT NOT NULL,
          summary TEXT,
          coordinates TEXT,
          expires_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          human_reviewed INTEGER DEFAULT 0
        )
      `).run();
    } catch (e) {
      // Table likely already exists
    }

    const noaaAlerts = await runNOAAPass(env.DB);
    const usgsAlerts = await runUSGSPass(env.DB);
    const gdacsAlerts = await runGDACSPass(env.DB);
    const total = noaaAlerts + usgsAlerts + gdacsAlerts;

    try {
      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('environment-monitor', CURRENT_TIMESTAMP, 'success', ?, ?)
      `).bind(total, JSON.stringify({
        noaa_alerts: noaaAlerts,
        usgs_alerts: usgsAlerts,
        gdacs_alerts: gdacsAlerts,
      })).run();
    } catch (e) {
      console.error('environment-monitor: failed to log agent run:', e.message);
    }

    console.log(`environment-monitor: completed — ${total} alerts generated`);
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      agent: 'environment-monitor',
      status: 'ok',
      sources: ['NOAA/NWS', 'USGS', 'GDACS'],
      tracked_destinations: DESTINATIONS.length,
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
