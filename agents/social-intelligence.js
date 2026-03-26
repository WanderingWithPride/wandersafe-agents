/**
 * WanderSafe Social Intelligence Agent
 *
 * Cloudflare Worker that monitors Reddit for real-time LGBTQ+ safety
 * signals about tracked destinations. Surfaces emerging safety concerns
 * from community channels that may not yet appear in news feeds or
 * legal databases.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. Social signals are inherently
 * noisier than legal or news data. Human review is especially critical
 * here to distinguish real safety signals from misinformation, satire,
 * or context-free posts.
 *
 * Data Sources (public access only — no private data):
 *   - Reddit r/gaytravelers — traveler Q&A and safety discussions
 *   - Reddit r/LGBTtravel — additional community travel feed
 *   - Reddit r/lgbt — high-volume international news and incident reporting
 *     (filtered for travel-related keywords only)
 *
 * Privacy Constraints:
 *   - Only public posts are monitored
 *   - Individual usernames are NOT stored in D1
 *   - No user profiling — destination-oriented, not person-oriented
 *
 * Schedule: NOT on cron (manual/request-driven only — Reddit API is rate-limited)
 *
 * Environment Variables Required:
 *   REDDIT_CLIENT_ID     — Reddit API app credentials
 *   REDDIT_CLIENT_SECRET — Reddit API app credentials
 *   DB                   — Cloudflare D1 database binding
 *
 * @module social-intelligence
 */

/** Subreddits to monitor and their search approach. */
const SUBREDDITS = [
  { name: 'gaytravelers', filterTravel: false },
  { name: 'LGBTtravel', filterTravel: false },
  { name: 'lgbt', filterTravel: true },  // high-volume: filter for travel keywords
];

/** Keywords that indicate travel relevance (for filtering r/lgbt). */
const TRAVEL_KEYWORDS = [
  'travel', 'trip', 'visit', 'vacation', 'holiday', 'airport',
  'hotel', 'hostel', 'flight', 'visa', 'border', 'customs',
  'safe to travel', 'safe to visit', 'safety', 'dangerous',
];

/** Destination keywords — same structure as news-monitor. */
const DESTINATION_KEYWORDS = {
  'IL':  ['israel', 'tel aviv', 'israeli'],
  'TR':  ['turkey', 'istanbul', 'turkish'],
  'AE':  ['dubai', 'uae', 'emirates', 'abu dhabi'],
  'JM':  ['jamaica', 'jamaican'],
  'ID':  ['indonesia', 'bali', 'indonesian'],
  'IN':  ['india', 'mumbai', 'indian'],
  'SG':  ['singapore'],
  'MA':  ['morocco', 'moroccan', 'marrakech'],
  'CU':  ['cuba', 'cuban', 'havana'],
  'TH':  ['thailand', 'bangkok', 'thai'],
  'UG':  ['uganda', 'ugandan', 'kampala'],
  'KE':  ['kenya', 'kenyan', 'nairobi'],
  'RU':  ['russia', 'russian', 'moscow'],
  'PL':  ['poland', 'polish', 'krakow', 'warsaw'],
  'HU':  ['hungary', 'hungarian', 'budapest'],
  'GH':  ['ghana', 'ghanaian', 'accra'],
  'NG':  ['nigeria', 'nigerian', 'lagos'],
  'EG':  ['egypt', 'egyptian', 'cairo'],
  'SA':  ['saudi arabia', 'saudi', 'riyadh'],
  'MY':  ['malaysia', 'malaysian', 'kuala lumpur'],
  'ES':  ['spain', 'madrid', 'barcelona'],
  'MX':  ['mexico', 'puerto vallarta', 'mexico city'],
  'DE':  ['germany', 'berlin'],
  'NL':  ['netherlands', 'amsterdam'],
  'AR':  ['argentina', 'buenos aires'],
};

/** Safety signal keywords and their severity weights. */
const SIGNAL_KEYWORDS = {
  critical: ['killed', 'murder', 'death', 'executed', 'stoned'],
  high:     ['arrested', 'detained', 'beaten', 'attacked', 'assaulted', 'raided', 'jailed', 'violence'],
  medium:   ['harassed', 'threatened', 'unsafe', 'dangerous', 'warning', 'avoid', 'careful', 'risk'],
  low:      ['discrimination', 'uncomfortable', 'stares', 'unwelcome', 'rude', 'hostile'],
};

/** Positive signal keywords (for balanced reporting). */
const POSITIVE_KEYWORDS = [
  'safe', 'welcoming', 'friendly', 'inclusive', 'amazing', 'wonderful',
  'loved it', 'felt welcome', 'great experience', 'no issues',
  'highly recommend', 'perfectly fine', 'very open',
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
 * Get Reddit OAuth access token using client credentials.
 * @param {object} env
 * @returns {Promise<string>} access token
 */
async function getRedditToken(env) {
  const auth = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'WanderSafe/1.0 (by /u/WanderSafeBot)',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Reddit auth failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Reddit auth: no access_token in response');
  }
  return data.access_token;
}

/**
 * Search a subreddit for posts matching a query.
 * @param {string} token - Reddit OAuth token
 * @param {string} subreddit
 * @param {string} query
 * @returns {Promise<Array>} posts
 */
async function searchSubreddit(token, subreddit, query) {
  const url = `https://oauth.reddit.com/r/${subreddit}/search?q=${encodeURIComponent(query)}&sort=new&limit=10&t=week&restrict_sr=on`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'WanderSafe/1.0 (by /u/WanderSafeBot)',
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      console.warn(`social-intelligence: rate limited on r/${subreddit}`);
      return [];
    }
    throw new Error(`Reddit search r/${subreddit}: HTTP ${res.status}`);
  }

  const data = await res.json();
  return (data?.data?.children ?? []).map(child => child.data);
}

/**
 * Match text against destination keywords.
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
 * Classify a post's severity based on keyword matching.
 * @param {string} text
 * @returns {{severity: string, isPositive: boolean}}
 */
function classifySignal(text) {
  const lower = text.toLowerCase();

  // Check positive signals first
  const positiveCount = POSITIVE_KEYWORDS.filter(kw => lower.includes(kw)).length;
  if (positiveCount >= 2) {
    return { severity: 'informational', isPositive: true };
  }

  // Check negative signals
  for (const [severity, keywords] of Object.entries(SIGNAL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return { severity, isPositive: false };
      }
    }
  }

  return { severity: 'informational', isPositive: false };
}

/**
 * Score a post for relevance based on multiple factors.
 * @param {object} post - Reddit post data
 * @param {string[]} matchedCountries
 * @returns {number} relevance score 0.0 - 1.0
 */
function scoreRelevance(post, matchedCountries) {
  let score = 0;

  // Title keyword match with destination = strong signal
  const titleMatches = matchDestinations(post.title);
  if (titleMatches.length > 0) score += 0.3;

  // Body/selftext match
  const bodyMatches = matchDestinations(post.selftext ?? '');
  if (bodyMatches.length > 0) score += 0.1;

  // Upvote ratio (community agreement)
  score += (post.upvote_ratio ?? 0.5) * 0.2;

  // Score (upvotes - downvotes)
  const postScore = post.score ?? 0;
  if (postScore > 50) score += 0.2;
  else if (postScore > 10) score += 0.1;
  else if (postScore > 3) score += 0.05;

  // Number of comments (discussion = signal)
  const comments = post.num_comments ?? 0;
  if (comments > 20) score += 0.15;
  else if (comments > 5) score += 0.1;
  else if (comments > 1) score += 0.05;

  return Math.min(score, 1.0);
}

/**
 * Check if a travel keyword exists in text (for filtering r/lgbt).
 * @param {string} text
 * @returns {boolean}
 */
function hasTravelKeyword(text) {
  const lower = text.toLowerCase();
  return TRAVEL_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Get destination ID from D1.
 */
async function getDestinationId(db, countryCode) {
  const row = await db.prepare(
    'SELECT id FROM destinations WHERE country_code = ? LIMIT 1'
  ).bind(countryCode).first();
  return row?.id ?? null;
}

/**
 * Check dedup.
 */
async function isDuplicate(db, hash) {
  const row = await db.prepare(
    "SELECT id FROM safety_alerts WHERE agent_type = 'social' AND raw_payload LIKE ?"
  ).bind(`%"dedup_hash":"${hash}"%`).first();
  return !!row;
}

/**
 * Insert a safety alert.
 */
async function insertAlert(db, alert) {
  await db.prepare(`
    INSERT INTO safety_alerts (
      destination_id, severity, agent_type, source_url, source_name,
      summary, human_reviewed, raw_payload, created_at
    ) VALUES (?, ?, 'social', ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
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
 * Run the full Reddit intelligence pass.
 * @param {D1Database} db
 * @param {string} token - Reddit OAuth token
 * @returns {Promise<number>} alert count
 */
async function runRedditPass(db, token) {
  let alertCount = 0;

  // Build search queries from high-risk destinations
  let destinations;
  try {
    const result = await db.prepare(
      'SELECT id, country_code, country_name, city, safety_tier FROM destinations WHERE safety_tier >= 2'
    ).all();
    destinations = result.results ?? [];
  } catch (e) {
    console.error('social-intelligence: failed to query destinations:', e.message);
    // Fall back to DESTINATION_KEYWORDS keys
    destinations = Object.keys(DESTINATION_KEYWORDS).map(code => ({
      id: code,
      country_code: code,
      country_name: code,
      city: null,
      safety_tier: 2,
    }));
  }

  for (const sub of SUBREDDITS) {
    for (const dest of destinations) {
      const destName = dest.city ? `${dest.city}` : dest.country_name;

      // Search queries
      const queries = [
        `"${destName}" safety`,
        `"${destName}" danger OR warning OR arrest`,
      ];

      for (const query of queries) {
        let posts;
        try {
          posts = await searchSubreddit(token, sub.name, query);
        } catch (e) {
          console.error(`social-intelligence: search failed r/${sub.name} "${query}":`, e.message);
          continue;
        }

        for (const post of posts) {
          const combinedText = `${post.title} ${post.selftext ?? ''}`;

          // For r/lgbt, filter for travel relevance
          if (sub.filterTravel && !hasTravelKeyword(combinedText)) continue;

          // Match destinations
          const matchedCountries = matchDestinations(combinedText);
          if (matchedCountries.length === 0) continue;

          // Score relevance
          const relevance = scoreRelevance(post, matchedCountries);
          if (relevance < 0.2) continue; // skip low-signal posts

          // Classify severity
          const { severity, isPositive } = classifySignal(combinedText);

          // Dedup by Reddit post ID
          const dedupHash = await sha256(`reddit-${post.id}`);
          if (await isDuplicate(db, dedupHash)) continue;

          const postUrl = `https://reddit.com${post.permalink}`;

          for (const countryCode of matchedCountries) {
            const destinationId = await getDestinationId(db, countryCode);
            if (!destinationId) continue;

            try {
              await insertAlert(db, {
                destinationId,
                severity,
                sourceUrl: postUrl,
                sourceName: `Reddit r/${sub.name}`,
                summary: `${isPositive ? 'Positive signal' : 'Safety signal'} from r/${sub.name}: "${post.title.substring(0, 200)}". Relevance: ${(relevance * 100).toFixed(0)}%. Requires human review before publishing.`,
                rawPayload: {
                  dedup_hash: dedupHash,
                  reddit_post_id: post.id,
                  subreddit: sub.name,
                  title: post.title,
                  score: post.score,
                  upvote_ratio: post.upvote_ratio,
                  num_comments: post.num_comments,
                  created_utc: post.created_utc,
                  relevance_score: relevance,
                  is_positive: isPositive,
                  // No username stored — privacy constraint
                },
              });
              alertCount++;
            } catch (e) {
              console.error(`social-intelligence: failed to insert alert for ${countryCode}:`, e.message);
            }
          }
        }
      }
    }
  }

  return alertCount;
}

export default {
  async scheduled(event, env, ctx) {
    // Social intelligence is request-driven only (Reddit rate limits).
    // This handler exists for the interface contract but logs a warning.
    console.warn('social-intelligence: scheduled() called but this agent is request-driven only. Use GET /social/run to trigger.');
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Manual trigger endpoint: GET /social/run
    if (url.pathname === '/social/run' || url.pathname === '/social/trigger') {
      if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
        return new Response(JSON.stringify({
          agent: 'social-intelligence',
          status: 'error',
          error: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be configured',
          timestamp: new Date().toISOString(),
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }

      let token;
      try {
        token = await getRedditToken(env);
      } catch (e) {
        return new Response(JSON.stringify({
          agent: 'social-intelligence',
          status: 'error',
          error: `Reddit auth failed: ${e.message}`,
          timestamp: new Date().toISOString(),
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      let alertCount = 0;
      try {
        alertCount = await runRedditPass(env.DB, token);
      } catch (e) {
        console.error('social-intelligence: Reddit pass failed:', e.message);
        return new Response(JSON.stringify({
          agent: 'social-intelligence',
          status: 'error',
          error: e.message,
          timestamp: new Date().toISOString(),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      try {
        await env.DB.prepare(`
          INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
          VALUES ('social-intelligence', CURRENT_TIMESTAMP, 'success', ?, ?)
        `).bind(alertCount, JSON.stringify({ trigger: 'manual', subreddits: SUBREDDITS.map(s => s.name) })).run();
      } catch (e) {
        console.error('social-intelligence: failed to log agent run:', e.message);
      }

      return new Response(JSON.stringify({
        agent: 'social-intelligence',
        status: 'ok',
        alerts_created: alertCount,
        subreddits_searched: SUBREDDITS.map(s => `r/${s.name}`),
        timestamp: new Date().toISOString(),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Health check (default)
    return new Response(JSON.stringify({
      agent: 'social-intelligence',
      status: 'ok',
      mode: 'manual-trigger',
      trigger_url: '/social/run',
      sources: SUBREDDITS.map(s => `r/${s.name}`),
      tracked_destinations: Object.keys(DESTINATION_KEYWORDS).length,
      reddit_configured: !!(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  },
};
