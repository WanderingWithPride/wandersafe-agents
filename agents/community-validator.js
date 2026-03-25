/**
 * WanderSafe Community Validator Agent
 *
 * Cloudflare Worker that receives traveler-submitted reports via Tally
 * webhook, validates the HMAC signature, classifies the report using Claude,
 * and writes to D1 for human review before anything publishes.
 *
 * NOTHING PUBLISHES WITHOUT HUMAN REVIEW. All reports are inserted with
 * human_reviewed = 0 and published_at = NULL. A trained reviewer must
 * approve each report through the /admin/queue interface.
 *
 * Report Intake Flow:
 *   1. Traveler submits via Tally form (linked from WanderSafe destination pages)
 *   2. Tally sends a signed webhook POST to /webhook/tally
 *   3. This Worker validates the HMAC-SHA256 signature
 *   4. Claude classifies the report (incident type, severity, audience, validity)
 *   5. PII is stripped; sanitized report writes to D1 with human_reviewed=0
 *   6. Human reviewer sees classified report in /admin/queue
 *   7. Reviewer approves → community_reports.approved=1, published_at=now()
 *   8. Approved report surfaces on the public destination page (anonymized)
 *
 * Routes:
 *   POST /webhook/tally    — Tally webhook receiver (HMAC-validated)
 *   GET  /admin/queue      — Protected: list pending reports
 *   POST /admin/approve    — Protected: approve a report
 *   POST /admin/reject     — Protected: reject a report
 *   GET  /                 — Health check
 *
 * Environment Variables Required:
 *   TALLY_WEBHOOK_SECRET  — HMAC secret from Tally webhook settings
 *   ANTHROPIC_API_KEY     — Claude API key for report classification
 *   ADMIN_PASSWORD        — Password for admin review interface
 *   DB                    — Cloudflare D1 database binding
 *
 * @module community-validator
 */

/**
 * Verify Tally HMAC-SHA256 webhook signature.
 * Tally signs the raw body with the webhook secret and sends:
 *   tally-signature: sha256=<hex>
 */
async function verifyTallySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expectedHex = signatureHeader.slice(7);

  // Convert expected hex to Uint8Array for constant-time comparison
  const expectedBytes = new Uint8Array(
    expectedHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
  );

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // crypto.subtle.verify performs constant-time comparison internally,
  // preventing timing side-channel attacks on the HMAC.
  return crypto.subtle.verify(
    'HMAC',
    key,
    expectedBytes,
    new TextEncoder().encode(rawBody)
  );
}

/**
 * Extract structured fields from a Tally webhook payload.
 * Tally sends fields as an array with key, label, type, value.
 */
function parseTallyPayload(payload) {
  const fields = payload?.data?.fields ?? [];
  const get = (label) => {
    const f = fields.find(f => f.label?.toLowerCase().includes(label.toLowerCase()));
    return f?.value ?? null;
  };

  return {
    responseId: payload?.data?.responseId ?? null,
    submittedAt: payload?.data?.submittedAt ?? new Date().toISOString(),
    destination: get('destination') ?? get('where') ?? get('location') ?? get('city') ?? null,
    incidentType: get('incident') ?? get('experience') ?? get('type') ?? null,
    description: get('description') ?? get('details') ?? get('what happened') ?? null,
    date: get('date') ?? get('when') ?? get('travel date') ?? null,
  };
}

/**
 * Classify a community report using Claude (Anthropic API).
 * Returns classification dimensions matching the community_reports D1 schema.
 */
async function classifyReport(report, apiKey) {
  const prompt = `You are a WanderSafe safety intelligence classifier. Analyze this LGBTQ+ traveler safety report and return a JSON classification.

Report:
- Destination: ${report.destination ?? 'unspecified'}
- Incident type (raw): ${report.incidentType ?? 'unspecified'}
- Description: ${report.description ?? 'no description provided'}
- Travel date: ${report.date ?? 'unspecified'}

Return ONLY valid JSON with these exact fields (no markdown, no explanation):
{
  "destination_normalized": "City, Country (normalized)",
  "country_code": "ISO 3166-1 alpha-2 or null",
  "incident_type": one of ["none","verbal_harassment","physical_threat","physical_assault","police_interaction","property_crime","discrimination","positive_experience","other"],
  "audience_tags": array from ["gay_men","lesbian","bisexual","trans","nonbinary","queer","poc_lgbtq","lgbtq_couple","solo_traveler"],
  "severity": one of ["informational","low","medium","high","critical"],
  "validity_score": float 0.0-1.0 based on specificity, internal consistency, and corroboration with known conditions,
  "summary": "1-2 sentence plain-language summary with no PII",
  "pii_detected": boolean
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2024-10-22',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '{}';
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Strip PII from report description before D1 storage.
 * Removes email addresses and phone numbers.
 */
function stripPII(text) {
  if (!text) return null;
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email redacted]')
    .replace(/\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g, '[phone redacted]');
}

/**
 * Verify admin access via Bearer token or ws_session cookie.
 * No query-parameter fallback — passwords must not appear in URLs.
 */
function isAuthorized(request, password) {
  // Bearer token (API / programmatic access)
  const auth = request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ') && auth.slice(7) === password) return true;

  // Cookie-based session (browser admin dashboard)
  const cookies = request.headers.get('Cookie') ?? '';
  const match = cookies.match(/(?:^|;\s*)ws_session=([^;]+)/);
  if (match && match[1] === password) return true;

  return false;
}

/**
 * Render the admin review queue as an HTML page.
 */
function renderQueue(reports, baseUrl) {
  if (reports.length === 0) {
    return '<p style="color:#888">No pending reports. All caught up.</p>';
  }

  return reports.map(r => `
    <div style="border:1px solid #ddd;padding:16px;margin:12px 0;border-radius:6px;background:#fafafa">
      <div style="font-size:12px;color:#888;margin-bottom:8px">
        ID: ${r.id} &bull;
        Submitted: ${r.submitted_at ?? r.created_at} &bull;
        Destination: <strong>${r.destination_normalized ?? r.destination_raw ?? '?'}</strong>
        ${r.country_code ? `(${r.country_code})` : ''}
      </div>
      <div style="margin-bottom:8px"><strong>Summary:</strong> ${r.summary ?? r.description_sanitized ?? '(no summary — classify manually)'}</div>
      <div style="margin-bottom:8px;font-size:13px">
        Incident: <code>${r.incident_type ?? '?'}</code> &bull;
        Severity: <code>${r.severity ?? '?'}</code> &bull;
        Validity score: <code>${r.validity_score != null ? Number(r.validity_score).toFixed(2) : '?'}</code>
      </div>
      ${r.classifier_error ? `<div style="color:#a02020;font-size:12px;margin-bottom:8px">Classifier error: ${r.classifier_error} — manual review required</div>` : ''}
      <div style="display:flex;gap:12px">
        <form method="POST" action="${baseUrl}/admin/approve">
          <input type="hidden" name="id" value="${r.id}">
          <button type="submit" style="background:#2a7a2a;color:#fff;padding:8px 20px;border:none;border-radius:4px;cursor:pointer">Approve &amp; Publish</button>
        </form>
        <form method="POST" action="${baseUrl}/admin/reject">
          <input type="hidden" name="id" value="${r.id}">
          <button type="submit" style="background:#a02020;color:#fff;padding:8px 20px;border:none;border-radius:4px;cursor:pointer">Reject</button>
        </form>
      </div>
    </div>
  `).join('');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    // Health check
    if (pathname === '/' || pathname === '/health') {
      return new Response(JSON.stringify({
        agent: 'community-validator',
        status: 'ok',
        intake: 'tally-webhook',
        storage: 'd1',
        timestamp: new Date().toISOString(),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Tally webhook receiver
    if (method === 'POST' && pathname === '/webhook/tally') {
      const rawBody = await request.text();
      const signatureHeader = request.headers.get('tally-signature');

      const valid = await verifyTallySignature(rawBody, signatureHeader, env.TALLY_WEBHOOK_SECRET);
      if (!valid) {
        return new Response('Unauthorized: invalid signature', { status: 401 });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response('Bad Request: invalid JSON', { status: 400 });
      }

      const report = parseTallyPayload(payload);

      if (!report.responseId) {
        return new Response('Bad Request: missing responseId', { status: 400 });
      }

      // Idempotency: check for duplicate
      const existing = await env.DB.prepare(
        'SELECT id FROM community_reports WHERE tally_response_id = ?'
      ).bind(report.responseId).first();

      if (existing) {
        return new Response(JSON.stringify({ status: 'duplicate', id: existing.id }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Classify with Claude
      let classification = null;
      let classificationError = null;
      try {
        classification = await classifyReport(report, env.ANTHROPIC_API_KEY);
      } catch (e) {
        classificationError = e.message;
        // Proceed without classification — human reviewer classifies manually
      }

      const sanitizedDescription = stripPII(report.description);

      // Insert into D1 — human_reviewed=0, approved=0, published_at=NULL always
      const result = await env.DB.prepare(`
        INSERT INTO community_reports (
          destination_raw,
          destination_normalized,
          country_code,
          incident_type,
          audience_tags,
          severity,
          validity_score,
          summary,
          description_sanitized,
          tally_response_id,
          submitted_at,
          human_reviewed,
          approved,
          published_at,
          classifier_error,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, CURRENT_TIMESTAMP)
      `).bind(
        report.destination,
        classification?.destination_normalized ?? null,
        classification?.country_code ?? null,
        classification?.incident_type ?? null,
        classification?.audience_tags ? JSON.stringify(classification.audience_tags) : null,
        classification?.severity ?? null,
        classification?.validity_score ?? null,
        classification?.summary ?? null,
        sanitizedDescription,
        report.responseId,
        report.submittedAt,
        classificationError,
      ).run();

      await env.DB.prepare(`
        INSERT INTO agent_runs (agent_type, finished_at, status, alerts_created, metadata)
        VALUES ('community-validator', CURRENT_TIMESTAMP, 'success', 1, ?)
      `).bind(JSON.stringify({ tally_response_id: report.responseId, destination: report.destination })).run();

      return new Response(JSON.stringify({
        status: 'received',
        id: result.meta?.last_row_id,
        classified: classification !== null,
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Admin: pending review queue
    if (method === 'GET' && pathname === '/admin/queue') {
      if (!isAuthorized(request, env.ADMIN_PASSWORD)) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer realm="WanderSafe Admin"' },
        });
      }

      const { results } = await env.DB.prepare(`
        SELECT id, destination_raw, destination_normalized, country_code,
               incident_type, severity, validity_score, summary,
               description_sanitized, submitted_at, created_at, classifier_error
        FROM community_reports
        WHERE human_reviewed = 0 AND approved = 0
        ORDER BY created_at DESC
        LIMIT 50
      `).all();

      const baseUrl = `${url.protocol}//${url.host}`;
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WanderSafe — Pending Review Queue</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 12px; }
    code { background: #eee; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>WanderSafe — Community Report Review Queue</h1>
  <p>${results.length} report(s) pending. <strong>Nothing is published until you approve it.</strong></p>
  ${renderQueue(results, baseUrl)}
</body>
</html>`;

      const bearerToken = (request.headers.get('Authorization') ?? '').slice(7);
      const headers = { 'Content-Type': 'text/html; charset=utf-8' };
      if (bearerToken) {
        headers['Set-Cookie'] = `ws_session=${bearerToken}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=3600`;
      }
      return new Response(html, { headers });
    }

    // Admin: approve
    if (method === 'POST' && pathname === '/admin/approve') {
      if (!isAuthorized(request, env.ADMIN_PASSWORD)) {
        return new Response('Unauthorized', { status: 401 });
      }

      const formData = await request.formData().catch(() => null);
      const id = formData?.get('id');

      if (!id) return new Response('Missing id', { status: 400 });

      await env.DB.prepare(`
        UPDATE community_reports
        SET human_reviewed = 1, approved = 1, published_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(id).run();

      return Response.redirect(`${url.protocol}//${url.host}/admin/queue`, 303);
    }

    // Admin: reject
    if (method === 'POST' && pathname === '/admin/reject') {
      if (!isAuthorized(request, env.ADMIN_PASSWORD)) {
        return new Response('Unauthorized', { status: 401 });
      }

      const formData = await request.formData().catch(() => null);
      const id = formData?.get('id');

      if (!id) return new Response('Missing id', { status: 400 });

      await env.DB.prepare(`
        UPDATE community_reports
        SET human_reviewed = 1, approved = 0
        WHERE id = ?
      `).bind(id).run();

      return Response.redirect(`${url.protocol}//${url.host}/admin/queue`, 303);
    }

    return new Response('Not Found', { status: 404 });
  },
};
