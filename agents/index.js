/**
 * WanderSafe Agents — Unified Router
 *
 * Single entry point for all 5 monitoring agents deployed as one Cloudflare Worker.
 * Routes fetch() requests by URL path and scheduled() calls by cron expression.
 */

import legalMonitor from './legal-monitor.js';
import communityValidator from './community-validator.js';
import newsMonitor from './news-monitor.js';
import eventMonitor from './event-monitor.js';
import socialIntelligence from './social-intelligence.js';
import environmentMonitor from './environment-monitor.js';
import accessibilityMonitor from './accessibility-monitor.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Community Validator routes
    if (path.startsWith('/webhook/tally') || path.startsWith('/admin')) {
      return communityValidator.fetch(request, env, ctx);
    }

    // Agent-specific health check routes
    if (path.startsWith('/legal')) {
      return legalMonitor.fetch(request, env, ctx);
    }
    if (path.startsWith('/community')) {
      return communityValidator.fetch(request, env, ctx);
    }
    if (path.startsWith('/news')) {
      return newsMonitor.fetch(request, env, ctx);
    }
    if (path.startsWith('/event')) {
      return eventMonitor.fetch(request, env, ctx);
    }
    if (path.startsWith('/social')) {
      return socialIntelligence.fetch(request, env, ctx);
    }
    if (path.startsWith('/environment')) {
      return environmentMonitor.fetch(request, env, ctx);
    }
    if (path.startsWith('/accessibility')) {
      return accessibilityMonitor.fetch(request, env, ctx);
    }

    // Root / health: combined health check
    if (path === '/' || path === '/health') {
      const agents = [
        { name: 'legal-monitor', module: legalMonitor },
        { name: 'community-validator', module: communityValidator },
        { name: 'news-monitor', module: newsMonitor },
        { name: 'event-monitor', module: eventMonitor },
        { name: 'social-intelligence', module: socialIntelligence },
        { name: 'environment-monitor', module: environmentMonitor },
        { name: 'accessibility-monitor', module: accessibilityMonitor },
      ];

      const statuses = {};
      for (const agent of agents) {
        try {
          const fakeReq = new Request('https://localhost/');
          const res = await agent.module.fetch(fakeReq, env, ctx);
          const data = await res.json();
          statuses[agent.name] = data.status ?? 'ok';
        } catch (e) {
          statuses[agent.name] = 'error';
        }
      }

      return new Response(JSON.stringify({
        service: 'wandersafe-agents',
        status: 'ok',
        agents: statuses,
        timestamp: new Date().toISOString(),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron;

    // Legal Monitor: Weekly Mon 06:00 UTC
    if (cron === '0 6 * * 1') {
      return legalMonitor.scheduled(event, env, ctx);
    }

    // News Monitor: Daily 06:00 UTC
    if (cron === '0 6 * * *') {
      return newsMonitor.scheduled(event, env, ctx);
    }

    // Event Monitor: Weekly Tue 06:00 UTC
    if (cron === '0 6 * * 2') {
      return eventMonitor.scheduled(event, env, ctx);
    }

    // Environment Monitor: Daily 08:00 UTC
    if (cron === '0 8 * * *') {
      return environmentMonitor.scheduled(event, env, ctx);
    }

    // Accessibility Monitor: Weekly Wed 06:00 UTC
    if (cron === '0 6 * * 3') {
      return accessibilityMonitor.scheduled(event, env, ctx);
    }

    console.warn(`wandersafe-agents: no handler for cron expression "${cron}"`);
  },
};
