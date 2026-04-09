/**
 * WanderSafe Accessibility Monitor Agent
 *
 * Cloudflare Worker that queries OpenStreetMap for wheelchair accessibility
 * data and tactile paving coverage near tracked destinations.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW.
 *
 * Data Sources:
 *   - OpenStreetMap Overpass API — wheelchair-accessible venues, tactile paving
 *
 * Schedule: Weekly Wed 06:00 UTC (cron: 0 6 * * 3)
 * Infrastructure data changes slowly, weekly refresh is sufficient.
 *
 * Environment Variables Required:
 *   DB — Cloudflare D1 database binding
 *
 * @module accessibility-monitor
 */

const DESTINATIONS = [
  { code: 'ES', name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { code: 'MX', name: 'Puerto Vallarta', lat: 20.6534, lon: -105.2253 },
  { code: 'PL', name: 'Krakow', lat: 50.0647, lon: 19.9450 },
  { code: 'IT', name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { code: 'DE', name: 'Berlin', lat: 52.5200, lon: 13.4050 },
  { code: 'NL', name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { code: 'TH', name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { code: 'AR', name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
  { code: 'JP', name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { code: 'ZA', name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { code: 'IS', name: 'Reykjavik', lat: 64.1466, lon: -21.9426 },
  { code: 'PT', name: 'Lisbon', lat: 38.7223, lon: -9.1393 },
  { code: 'CZ', name: 'Prague', lat: 50.0755, lon: 14.4378 },
];

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'WanderSafe/1.0 (+https://wanderingwithpride.com)';

// ~5km radius bounding box offset (in degrees, rough approximation)
const BBOX_OFFSET = 0.045;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/**
 * Query Overpass API for wheelchair-accessible venues in a bounding box.
 * Uses a tight bbox (~5km radius) to keep response size manageable.
 * Returns count of wheelchair=yes nodes/ways.
 */
async function queryWheelchairVenues(lat, lon) {
  const south = lat - BBOX_OFFSET;
  const north = lat + BBOX_OFFSET;
  const west = lon - BBOX_OFFSET;
  const east = lon + BBOX_OFFSET;

  const query = `[out:json][timeout:30];
(
  node["wheelchair"="yes"](${south},${west},${north},${east});
  way["wheelchair"="yes"](${south},${west},${north},${east});
);
out count;`;

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}`);
  const data = await response.json();
  return data.elements?.[0]?.tags?.total ?? data.elements?.length ?? 0;
}

/**
 * Query Overpass API for tactile paving nodes in a bounding box.
 */
async function queryTactilePaving(lat, lon) {
  const south = lat - BBOX_OFFSET;
  const north = lat + BBOX_OFFSET;
  const west = lon - BBOX_OFFSET;
  const east = lon + BBOX_OFFSET;

  const query = `[out:json][timeout:30];
node["tactile_paving"="yes"](${south},${west},${north},${east});
out count;`;

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}`);
  const data = await response.json();
  return data.elements?.[0]?.tags?.total ?? data.elements?.length ?? 0;
}

export default {
  async scheduled(event, env, ctx) {
    console.log('accessibility-monitor: scheduled run started', new Date().toISOString());

    // Ensure table exists
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS accessibility_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          destination_id TEXT NOT NULL,
          wheelchair_venues_count INTEGER DEFAULT 0,
          tactile_paving_count INTEGER DEFAULT 0,
          transit_accessibility_score REAL,
          transit_accessible_stops INTEGER DEFAULT 0,
          transit_total_stops INTEGER DEFAULT 0,
          source TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
    } catch (e) {
      // Table likely exists
    }

    let successCount = 0;
    let errorCount = 0;

    for (const dest of DESTINATIONS) {
      const destinationId = await getDestinationId(env.DB, dest.code);
      if (!destinationId) {
        console.warn(`accessibility-monitor: no destination for ${dest.code}`);
        continue;
      }

      let wheelchairCount = 0;
      let tactileCount = 0;

      try {
        wheelchairCount = await queryWheelchairVenues(dest.lat, dest.lon);
        await sleep(2000); // Be nice to Overpass
        tactileCount = await queryTactilePaving(dest.lat, dest.lon);
        await sleep(2000);
      } catch (e) {
        console.error(`accessibility-monitor: Overpass failed for ${dest.name}:`, e.message);
        errorCount++;
        await sleep(5000); // Back off on error
        continue;
      }

      // Upsert accessibility data
      try {
        await env.DB.prepare(`
          INSERT INTO accessibility_data (destination_id, wheelchair_venues_count, tactile_paving_count, source, updated_at)
          VALUES (?, ?, ?, 'OpenStreetMap', CURRENT_TIMESTAMP)
          ON CONFLICT(destination_id, source) DO UPDATE SET
            wheelchair_venues_count = excluded.wheelchair_venues_count,
            tactile_paving_count = excluded.tactile_paving_count,
            updated_at = CURRENT_TIMESTAMP
        `).bind(destinationId, wheelchairCount, tactileCount).run();
      } catch (e) {
        // If upsert fails (no unique constraint yet), do insert
        await env.DB.prepare(`
          INSERT INTO accessibility_data (destination_id, wheelchair_venues_count, tactile_paving_count, source, updated_at)
          VALUES (?, ?, ?, 'OpenStreetMap', CURRENT_TIMESTAMP)
        `).bind(destinationId, wheelchairCount, tactileCount).run();
      }

      successCount++;
      console.log(`accessibility-monitor: ${dest.name} — ${wheelchairCount} wheelchair venues, ${tactileCount} tactile paving`);
    }

    try {
      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('accessibility-monitor', CURRENT_TIMESTAMP, 'success', 0, ?)
      `).bind(JSON.stringify({
        destinations_scanned: successCount,
        errors: errorCount,
      })).run();
    } catch (e) {
      console.error('accessibility-monitor: failed to log agent run:', e.message);
    }

    console.log(`accessibility-monitor: completed — ${successCount} destinations scanned, ${errorCount} errors`);
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      agent: 'accessibility-monitor',
      status: 'ok',
      sources: ['OpenStreetMap Overpass API'],
      tracked_destinations: DESTINATIONS.length,
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
