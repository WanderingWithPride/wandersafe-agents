/**
 * WanderSafe News Monitor Agent
 *
 * Cloudflare Worker that polls LGBTQ+-focused and human rights news
 * RSS feeds and Brave Search API for safety-relevant stories about
 * tracked destinations.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. All generated alerts
 * are inserted with human_reviewed = 0 and must be approved
 * through the admin interface before reaching the public platform.
 *
 * Data Sources:
 *   - PinkNews (pinknews.co.uk/feed) — global LGBTQ+ news
 *   - LGBTQ Nation (lgbtqnation.com/feed) — US and international coverage
 *   - The Advocate (advocate.com/feed) — US and international LGBTQ+ news
 *   - Human Rights Watch (hrw.org/rss/lgbtq) — authoritative human rights docs
 *   - Openly / Thomson Reuters (openlynews.com/feed) — LGBTQ+ wire service
 *   - Google News RSS — supplemental LGBTQ+ safety news via search queries
 *
 * Schedule: Daily 06:00 UTC (cron: 0 6 * * *)
 *
 * Environment Variables Required:
 *   DB            — Cloudflare D1 database binding
 *   BRAVE_API_KEY — Brave Search API key (for supplemental web search)
 *
 * @module news-monitor
 */

const RSS_FEEDS = [
  { name: 'PinkNews', url: 'https://www.pinknews.co.uk/feed/' },
  { name: 'LGBTQ Nation', url: 'https://www.lgbtqnation.com/feed/' },
  { name: 'The Advocate', url: 'https://www.advocate.com/feed' },
  { name: 'Human Rights Watch', url: 'https://www.hrw.org/rss/lgbtq' },
  { name: 'Openly (Reuters)', url: 'https://www.openlynews.com/feed/' },
];

const DESTINATION_KEYWORDS = {
  'IL':       ['israel', 'tel aviv', 'israeli'],
  'TR':       ['turkey', 'istanbul', 'turkish', 'erdogan'],
  'AE':       ['dubai', 'uae', 'emirates', 'abu dhabi'],
  'JM':       ['jamaica', 'jamaican'],
  'ID':       ['indonesia', 'bali', 'indonesian'],
  'IN':       ['india', 'mumbai', 'indian', 'modi'],
  'SG':       ['singapore'],
  'MA':       ['morocco', 'moroccan', 'marrakech'],
  'CU':       ['cuba', 'cuban', 'havana'],
  'TH':       ['thailand', 'bangkok', 'thai'],
  'UG':       ['uganda', 'ugandan', 'kampala'],
  'KE':       ['kenya', 'kenyan', 'nairobi'],
  'RU':       ['russia', 'russian', 'moscow'],
  'PL':       ['poland', 'polish', 'krakow', 'warsaw'],
  'HU':       ['hungary', 'hungarian', 'budapest'],
  'GH':       ['ghana', 'ghanaian', 'accra'],
  'NG':       ['nigeria', 'nigerian', 'lagos'],
  'EG':       ['egypt', 'egyptian', 'cairo'],
  'SA':       ['saudi arabia', 'saudi', 'riyadh'],
  'MY':       ['malaysia', 'malaysian', 'kuala lumpur'],
};

/** Severity keywords — map keywords in titles/descriptions to severity levels. */
const SEVERITY_KEYWORDS = {
  critical: ['death penalty', 'execution', 'killed', 'murder', 'massacre', 'genocide'],
  high:     ['arrested', 'arrest', 'imprisoned', 'jail', 'crackdown', 'raid', 'violence', 'attack', 'assault', 'mob'],
  medium:   ['law', 'legislation', 'ban', 'banned', 'illegal', 'criminalize', 'fine', 'threat', 'warning'],
  low:      ['discrimination', 'protest', 'pride', 'rights', 'ruling', 'court', 'debate'],
};

/**
 * Generate a SHA-256 hash for deduplication.
 * @param {string} input
 * @returns {Promise<string>} hex digest
 */
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse RSS XML items using regex (no external deps needed on CF Workers).
 * @param {string} xml
 * @returns {Array<{title: string, description: string, link: string, pubDate: string}>}
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
    const dateMatch  = item.match(/<pubDate>(.*?)<\/pubDate>/);

    if (!titleMatch) continue;

    items.push({
      title: titleMatch[1].trim().replace(/<[^>]+>/g, ''),
      description: (descMatch?.[1] ?? '').trim().replace(/<[^>]+>/g, ''),
      link: linkMatch?.[1]?.trim() ?? '',
      pubDate: dateMatch?.[1]?.trim() ?? '',
    });
  }
  return items;
}

/**
 * Match text against destination keywords. Returns array of matching country codes.
 * @param {string} text
 * @returns {string[]} country codes
 */
function matchDestinations(text) {
  const lower = text.toLowerCase();
  const matches = [];
  for (const [countryCode, keywords] of Object.entries(DESTINATION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        matches.push(countryCode);
        break;
      }
    }
  }
  return matches;
}

/**
 * Determine severity from text content.
 * @param {string} text - combined title + description
 * @returns {string} severity level
 */
function classifySeverity(text) {
  const lower = text.toLowerCase();
  for (const [severity, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return severity;
    }
  }
  return 'informational';
}

/**
 * Get destination ID from D1 by country code.
 * @param {D1Database} db
 * @param {string} countryCode
 * @returns {Promise<string|null>}
 */
async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/**
 * Check if a dedup hash already exists in safety_alerts for the news agent.
 * @param {D1Database} db
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function isDuplicate(db, hash) {
  const row = await db.prepare(
    "SELECT id FROM safety_alerts WHERE agent_type = 'news' AND raw_payload LIKE ?"
  ).bind(`%"dedup_hash":"${hash}"%`).first();
  return !!row;
}

/**
 * Insert a safety alert into D1.
 * @param {D1Database} db
 * @param {object} alert
 */
async function insertAlert(db, alert) {
  await db.prepare(`
    INSERT INTO safety_alerts (
      destination_id, severity, agent_type, source_url, source_name,
      summary, human_reviewed, raw_payload, created_at
    ) VALUES (?, ?, 'news', ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
  `).bind(
    alert.destinationId,
    alert.severity,
    alert.sourceUrl,
    alert.sourceName,
    alert.summary,
    JSON.stringify(alert.rawPayload ?? {}),
  ).run();
}

/**
 * Fetch and process a single RSS feed.
 * @param {object} feed - {name, url}
 * @param {D1Database} db
 * @returns {Promise<number>} number of alerts created
 */
async function processFeed(feed, db) {
  let alertCount = 0;
  let xml;

  try {
    const response = await fetch(feed.url, {
      headers: { 'User-Agent': 'WanderSafe/1.0 (+https://wanderingwithpride.com)' },
    });
    if (!response.ok) {
      console.error(`news-monitor: ${feed.name} HTTP ${response.status}`);
      return 0;
    }
    xml = await response.text();
  } catch (e) {
    console.error(`news-monitor: ${feed.name} fetch failed:`, e.message);
    return 0;
  }

  const items = parseRSSItems(xml);

  for (const item of items) {
    const combinedText = `${item.title} ${item.description}`;
    const matchedCountries = matchDestinations(combinedText);

    if (matchedCountries.length === 0) continue;

    const dedupHash = await sha256(item.link || item.title);

    if (await isDuplicate(db, dedupHash)) continue;

    const severity = classifySeverity(combinedText);

    for (const countryCode of matchedCountries) {
      const destinationId = await getDestinationId(db, countryCode);
      if (!destinationId) continue;

      try {
        await insertAlert(db, {
          destinationId,
          severity,
          sourceUrl: item.link,
          sourceName: feed.name,
          summary: `${item.title}. Source: ${feed.name}. Requires human review before publishing.`,
          rawPayload: {
            dedup_hash: dedupHash,
            title: item.title,
            description: item.description.substring(0, 500),
            pub_date: item.pubDate,
            feed_name: feed.name,
          },
        });
        alertCount++;
      } catch (e) {
        console.error(`news-monitor: failed to insert alert for ${countryCode}:`, e.message);
      }
    }
  }

  return alertCount;
}

/**
 * Run Brave Search for high-risk/caution destinations.
 * @param {D1Database} db
 * @param {string} braveApiKey
 * @returns {Promise<number>} number of alerts created
 */
async function runBraveSearch(db, braveApiKey) {
  if (!braveApiKey) {
    console.warn('news-monitor: BRAVE_API_KEY not set, skipping Brave Search');
    return 0;
  }

  let alertCount = 0;

  // Get destinations with safety_tier >= 2 (caution or higher risk)
  let destinations;
  try {
    const result = await db.prepare(
      'SELECT id, country_name, city, safety_tier FROM destinations WHERE safety_tier >= 2'
    ).all();
    destinations = result.results ?? [];
  } catch (e) {
    console.error('news-monitor: failed to query destinations:', e.message);
    return 0;
  }

  for (const dest of destinations) {
    const destName = dest.city ? `${dest.city} ${dest.country_name}` : dest.country_name;
    const query = `"${destName}" LGBTQ safety OR rights OR law 2026`;

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': braveApiKey,
          },
        }
      );

      if (!response.ok) {
        console.error(`news-monitor: Brave Search for "${destName}" HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const results = data.web?.results ?? [];

      for (const result of results) {
        const dedupHash = await sha256(result.url);
        if (await isDuplicate(db, dedupHash)) continue;

        const combinedText = `${result.title} ${result.description ?? ''}`;
        const severity = classifySeverity(combinedText);

        try {
          await insertAlert(db, {
            destinationId: dest.id,
            severity,
            sourceUrl: result.url,
            sourceName: 'Brave Search',
            summary: `${result.title}. Requires human review before publishing.`,
            rawPayload: {
              dedup_hash: dedupHash,
              title: result.title,
              description: (result.description ?? '').substring(0, 500),
              search_query: query,
              destination_name: destName,
            },
          });
          alertCount++;
        } catch (e) {
          console.error(`news-monitor: failed to insert Brave result for ${destName}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`news-monitor: Brave Search failed for "${destName}":`, e.message);
    }
  }

  return alertCount;
}

// ---------------------------------------------------------------------------
// Google News RSS — supplemental LGBTQ+ safety news search
// ---------------------------------------------------------------------------

/**
 * Google News search queries for LGBTQ+ travel safety.
 * These are intentionally broad to catch relevant stories that
 * the dedicated LGBTQ+ RSS feeds might miss.
 */
const GOOGLE_NEWS_QUERIES = [
  'LGBTQ+ travel safety',
  'gay rights crackdown',
  'transgender law travel',
  'anti-gay legislation',
  'LGBTQ+ arrest',
];

/**
 * Run Google News RSS search for LGBTQ+ travel safety stories.
 * Uses Google News search RSS which returns ~100 results per query.
 * Deduplicates against existing alerts by article URL hash.
 *
 * @param {D1Database} db
 * @returns {Promise<number>} number of alerts created
 */
async function runGoogleNewsSearch(db) {
  let alertCount = 0;

  for (const query of GOOGLE_NEWS_QUERIES) {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;

    let xml;
    try {
      const response = await fetch(rssUrl, {
        headers: { 'User-Agent': 'WanderSafe/1.0 (+https://wanderingwithpride.com)' },
      });
      if (!response.ok) {
        console.error(`news-monitor: Google News RSS "${query}" HTTP ${response.status}`);
        continue;
      }
      xml = await response.text();
    } catch (e) {
      console.error(`news-monitor: Google News RSS "${query}" fetch failed:`, e.message);
      continue;
    }

    const items = parseRSSItems(xml);

    // Cap at 20 items per query to avoid noise (Perplexity recommendation)
    for (const item of items.slice(0, 20)) {
      const combinedText = `${item.title} ${item.description}`;
      const matchedCountries = matchDestinations(combinedText);

      if (matchedCountries.length === 0) continue;

      const dedupHash = await sha256(item.link || item.title);
      if (await isDuplicate(db, dedupHash)) continue;

      const severity = classifySeverity(combinedText);

      for (const countryCode of matchedCountries) {
        const destinationId = await getDestinationId(db, countryCode);
        if (!destinationId) continue;

        try {
          await insertAlert(db, {
            destinationId,
            severity,
            sourceUrl: item.link,
            sourceName: 'Google News',
            summary: `${item.title}. Source: Google News. Requires human review before publishing.`,
            rawPayload: {
              dedup_hash: dedupHash,
              title: item.title,
              description: (item.description ?? '').substring(0, 500),
              pub_date: item.pubDate,
              search_query: query,
            },
          });
          alertCount++;
        } catch (e) {
          console.error(`news-monitor: failed to insert Google News alert for ${countryCode}:`, e.message);
        }
      }
    }
  }

  return alertCount;
}

export default {
  async scheduled(event, env, ctx) {
    console.log('news-monitor: scheduled run started', new Date().toISOString());

    let rssAlerts = 0;
    let braveAlerts = 0;
    let googleNewsAlerts = 0;

    // Process all RSS feeds
    for (const feed of RSS_FEEDS) {
      try {
        const count = await processFeed(feed, env.DB);
        rssAlerts += count;
        console.log(`news-monitor: ${feed.name} — ${count} alerts`);
      } catch (e) {
        console.error(`news-monitor: ${feed.name} processing failed:`, e.message);
      }
    }

    // Run Brave Search for high-risk destinations
    try {
      braveAlerts = await runBraveSearch(env.DB, env.BRAVE_API_KEY);
      console.log(`news-monitor: Brave Search — ${braveAlerts} alerts`);
    } catch (e) {
      console.error('news-monitor: Brave Search pass failed:', e.message);
    }

    // Run Google News RSS search
    try {
      googleNewsAlerts = await runGoogleNewsSearch(env.DB);
      console.log(`news-monitor: Google News — ${googleNewsAlerts} alerts`);
    } catch (e) {
      console.error('news-monitor: Google News pass failed:', e.message);
    }

    const total = rssAlerts + braveAlerts + googleNewsAlerts;

    try {
      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('news-monitor', CURRENT_TIMESTAMP, 'success', ?, ?)
      `).bind(total, JSON.stringify({
        rss_alerts: rssAlerts,
        brave_alerts: braveAlerts,
        google_news_alerts: googleNewsAlerts,
      })).run();
    } catch (e) {
      console.error('news-monitor: failed to log agent run:', e.message);
    }

    console.log(`news-monitor: completed — ${total} alerts generated`);
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      agent: 'news-monitor',
      status: 'ok',
      sources: RSS_FEEDS.map(f => f.name).concat(['Brave Search', 'Google News RSS']),
      tracked_destinations: Object.keys(DESTINATION_KEYWORDS).length,
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
