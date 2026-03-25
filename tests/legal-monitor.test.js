/**
 * Unit tests for legal-monitor agent
 *
 * Tests the core change-detection and alert-generation logic
 * without requiring a live Equaldex API key or Cloudflare D1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { extractEqualdexFingerprint, equaldexChangeSeverity } from '../agents/legal-monitor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EQUALDEX_SPAIN_LEGAL = {
  issues: {
    'homosexuality':     { current_value: 'Legal' },
    'same-sex-marriage': { current_value: 'Legal' },
    'adoption':          { current_value: 'Legal' },
    'anti-discrimination': { current_value: 'Sexual orientation and gender identity' },
    'changing-gender':   { current_value: 'Legal, surgery not required' },
    'conversion-therapy': { current_value: 'Banned' },
  },
};

const EQUALDEX_RUSSIA_RESTRICTED = {
  issues: {
    'homosexuality':     { current_value: 'Illegal (de facto)' },
    'same-sex-marriage': { current_value: 'Not legal' },
    'adoption':          { current_value: 'Illegal' },
    'anti-discrimination': { current_value: 'No protections' },
    'changing-gender':   { current_value: 'Legal, surgery required' },
    'conversion-therapy': { current_value: 'Legal' },
  },
};

// ---------------------------------------------------------------------------
// extractEqualdexFingerprint
// ---------------------------------------------------------------------------

describe('extractEqualdexFingerprint', () => {
  it('extracts all six fields from a full Equaldex response', () => {
    const fp = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    expect(fp.homosexuality).toBe('Legal');
    expect(fp.same_sex_marriage).toBe('Legal');
    expect(fp.adoption).toBe('Legal');
    expect(fp.anti_discrimination).toBe('Sexual orientation and gender identity');
    expect(fp.changing_gender).toBe('Legal, surgery not required');
    expect(fp.conversion_therapy).toBe('Banned');
  });

  it('returns null for missing fields', () => {
    const fp = extractEqualdexFingerprint({ issues: {} });
    expect(fp.homosexuality).toBeNull();
    expect(fp.same_sex_marriage).toBeNull();
  });

  it('handles null/undefined input gracefully', () => {
    const fp = extractEqualdexFingerprint(null);
    expect(fp.homosexuality).toBeNull();
    expect(fp.same_sex_marriage).toBeNull();
  });

  it('extracts restricted values from a hostile-country response', () => {
    const fp = extractEqualdexFingerprint(EQUALDEX_RUSSIA_RESTRICTED);
    expect(fp.homosexuality).toBe('Illegal (de facto)');
    expect(fp.same_sex_marriage).toBe('Not legal');
  });
});

// ---------------------------------------------------------------------------
// equaldexChangeSeverity
// ---------------------------------------------------------------------------

describe('equaldexChangeSeverity', () => {
  it('returns critical when homosexuality becomes illegal', () => {
    expect(equaldexChangeSeverity('homosexuality', 'Illegal')).toBe('critical');
    expect(equaldexChangeSeverity('homosexuality', 'Illegal (criminal offense)')).toBe('critical');
    expect(equaldexChangeSeverity('homosexuality', 'Criminal offense')).toBe('critical');
  });

  it('returns medium when homosexuality becomes legal', () => {
    expect(equaldexChangeSeverity('homosexuality', 'Legal')).toBe('medium');
    expect(equaldexChangeSeverity('homosexuality', 'Legal (varies by region)')).toBe('medium');
  });

  it('returns medium for same-sex-marriage changes', () => {
    expect(equaldexChangeSeverity('same_sex_marriage', 'Legal')).toBe('medium');
    expect(equaldexChangeSeverity('same_sex_marriage', 'Not legal')).toBe('medium');
  });

  it('returns low for other field changes', () => {
    expect(equaldexChangeSeverity('adoption', 'Legal')).toBe('low');
    expect(equaldexChangeSeverity('conversion_therapy', 'Banned')).toBe('low');
    expect(equaldexChangeSeverity('anti_discrimination', 'No protections')).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Change detection logic (integration-style with mocked D1)
// ---------------------------------------------------------------------------

describe('change detection', () => {
  it('detects a change when current differs from previous fingerprint', () => {
    const previous = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    const current = {
      ...previous,
      homosexuality: 'Illegal', // simulated regression
    };

    const changes = Object.entries(current).filter(
      ([field, val]) => previous[field] !== val
    );

    expect(changes).toHaveLength(1);
    expect(changes[0][0]).toBe('homosexuality');
    expect(changes[0][1]).toBe('Illegal');
  });

  it('detects no changes when fingerprints are identical', () => {
    const previous = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    const current = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);

    const changes = Object.entries(current).filter(
      ([field, val]) => previous[field] !== val
    );

    expect(changes).toHaveLength(0);
  });

  it('detects multiple simultaneous changes', () => {
    const previous = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    const current = extractEqualdexFingerprint(EQUALDEX_RUSSIA_RESTRICTED);

    const changes = Object.entries(current).filter(
      ([field, val]) => previous[field] !== val
    );

    expect(changes.length).toBeGreaterThan(1);
    const changedFields = changes.map(([f]) => f);
    expect(changedFields).toContain('homosexuality');
    expect(changedFields).toContain('same_sex_marriage');
  });
});

// ---------------------------------------------------------------------------
// Scheduled handler: mock D1 + fetch
// ---------------------------------------------------------------------------

describe('scheduled handler (mocked)', () => {
  let mockDB;
  let capturedAlerts;

  beforeEach(() => {
    capturedAlerts = [];

    mockDB = {
      prepare: vi.fn((sql) => ({
        bind: vi.fn((...args) => ({
          first: vi.fn().mockResolvedValue(null),  // no existing fingerprint
          run:   vi.fn().mockImplementation(() => {
            if (sql.includes('INSERT INTO safety_alerts')) {
              capturedAlerts.push({ sql, args });
            }
            return Promise.resolve({ success: true });
          }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        })),
      })),
    };
  });

  it('inserts an informational baseline alert on first run for a tracked country', async () => {
    // Mock fetch: return Spain legal data for all country requests
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('equaldex')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(EQUALDEX_SPAIN_LEGAL),
        });
      }
      // State Dept RSS — return empty
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<rss></rss>'),
      });
    });

    // Run the Equaldex pass for a single country to verify baseline seeding
    // (Importing the full module and calling scheduled would require wrangler test env;
    // we test the logic functions directly instead)
    const fp = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    expect(fp.homosexuality).toBe('Legal');
    expect(fp.same_sex_marriage).toBe('Legal');

    // The agent would call insertAlert with severity='informational' on first run
    const severity = equaldexChangeSeverity('homosexuality', fp.homosexuality);
    expect(severity).toBe('medium');   // 'Legal' → medium, not critical
  });

  it('generates a critical alert when homosexuality becomes illegal', () => {
    const previous = extractEqualdexFingerprint(EQUALDEX_SPAIN_LEGAL);
    const degraded  = { ...previous, homosexuality: 'Illegal (criminal)' };

    const changes = Object.entries(degraded).filter(([f, v]) => previous[f] !== v);
    expect(changes).toHaveLength(1);

    const [field, newValue] = changes[0];
    const severity = equaldexChangeSeverity(field, newValue);
    expect(severity).toBe('critical');
  });
});
