/**
 * Unit tests for LegiScan integration in legal-monitor agent
 *
 * Tests classifyBillSeverity, deduplicateBills, and search query coverage
 * without requiring a live LegiScan API key or Cloudflare D1.
 */

import { describe, it, expect } from 'vitest';

import {
  classifyBillSeverity,
  deduplicateBills,
  LEGISCAN_SEARCH_QUERIES,
  LEGISCAN_TARGET_STATES,
} from '../agents/legal-monitor.js';

// ---------------------------------------------------------------------------
// Fixtures — synthetic bill objects matching LegiScan API shape
// ---------------------------------------------------------------------------

const BILL_TRANS_HEALTHCARE_BAN = {
  bill_id: 10001,
  bill_number: 'HB 1',
  state: 'FL',
  title: 'Prohibiting Gender-Affirming Care for Minors',
  description: 'A bill to ban gender-affirming healthcare procedures for individuals under 18.',
  status: 1,
  last_action: 'Signed by Governor',
  last_action_date: '2026-03-01',
  url: 'https://legiscan.com/FL/bill/HB1/2026',
};

const BILL_BATHROOM_RESTRICTION = {
  bill_id: 10002,
  bill_number: 'SB 12',
  state: 'TX',
  title: 'Bathroom Bill: Restricting Bathroom Access Based on Biological Sex',
  description: 'Prohibits individuals from using restrooms or locker rooms that do not correspond to their sex assigned at birth.',
  status: 1,
  last_action: 'Referred to Committee',
  last_action_date: '2026-02-15',
  url: 'https://legiscan.com/TX/bill/SB12/2026',
};

const BILL_PARENTAL_NOTIFICATION = {
  bill_id: 10003,
  bill_number: 'HB 55',
  state: 'TN',
  title: 'Parental Notification in Schools',
  description: 'Requires parental consent before school counselors may discuss sexual orientation or gender identity topics with students.',
  status: 2,
  last_action: 'Passed Senate',
  last_action_date: '2026-01-20',
  url: 'https://legiscan.com/TN/bill/HB55/2026',
};

const BILL_STUDY_COMMITTEE = {
  bill_id: 10004,
  bill_number: 'HR 3',
  state: 'OH',
  title: 'Establishing a Study Committee on LGBTQ Youth in Schools',
  description: 'Creates a legislative study committee to examine issues affecting LGBTQ youth in public schools.',
  status: 1,
  last_action: 'Introduced',
  last_action_date: '2026-01-05',
  url: 'https://legiscan.com/OH/bill/HR3/2026',
};

const BILL_CRIMINALIZE_DRAG = {
  bill_id: 10005,
  bill_number: 'SB 99',
  state: 'GA',
  title: 'Banning Drag Performances in Public',
  description: 'Makes it a misdemeanor to perform drag in a public space where minors may be present.',
  status: 1,
  last_action: 'Passed House',
  last_action_date: '2026-03-10',
  url: 'https://legiscan.com/GA/bill/SB99/2026',
};

const BILL_CONVERSION_THERAPY_BAN = {
  bill_id: 10006,
  bill_number: 'HB 88',
  state: 'US',
  title: 'Federal Prohibition of Conversion Therapy',
  description: 'Prohibits licensed mental health providers from engaging in conversion therapy with minors.',
  status: 1,
  last_action: 'Introduced in Senate',
  last_action_date: '2026-02-01',
  url: 'https://legiscan.com/US/bill/HB88/2026',
};

const BILL_FELONY_GENDER_CARE = {
  bill_id: 10007,
  bill_number: 'SB 200',
  state: 'MO',
  title: 'Felony Classification for Gender-Affirming Healthcare Providers',
  description: 'Classifies as a felony the provision of gender-affirming medical care to any person under 21.',
  status: 1,
  last_action: 'Committee Hearing',
  last_action_date: '2026-03-15',
  url: 'https://legiscan.com/MO/bill/SB200/2026',
};

const BILL_DONT_SAY_GAY = {
  bill_id: 10008,
  bill_number: 'HB 301',
  state: 'KY',
  title: "Don't Say Gay: Restricting LGBTQ Discussion in K-12 Classrooms",
  description: 'Prohibits classroom instruction on sexual orientation or gender identity in grades K-12.',
  status: 1,
  last_action: 'Passed House',
  last_action_date: '2026-03-20',
  url: 'https://legiscan.com/KY/bill/HB301/2026',
};

const BILL_HORMONE_BAN = {
  bill_id: 10009,
  bill_number: 'HB 400',
  state: 'SC',
  title: 'Ban on Hormone Therapy for Transgender Youth',
  description: 'Prohibits physicians from prescribing hormone therapy to transgender individuals under 18.',
  status: 1,
  last_action: 'Signed',
  last_action_date: '2026-04-01',
  url: 'https://legiscan.com/SC/bill/HB400/2026',
};

const BILL_DISCLOSURE = {
  bill_id: 10010,
  bill_number: 'SB 77',
  state: 'IN',
  title: 'Mandatory Disclosure of LGBTQ Student Support Programs',
  description: 'Requires disclosure reporting by schools that offer LGBTQ-inclusive support programs.',
  status: 1,
  last_action: 'First Reading',
  last_action_date: '2026-01-10',
  url: 'https://legiscan.com/IN/bill/SB77/2026',
};

const BILL_RELIGIOUS_EXEMPTION = {
  bill_id: 10011,
  bill_number: 'HB 500',
  state: 'LA',
  title: 'Religious Exemption to Enable Discrimination Against LGBTQ Individuals',
  description: 'Permits businesses to refuse service based on religious objections, enabling discrimination against LGBTQ customers.',
  status: 1,
  last_action: 'Committee',
  last_action_date: '2026-02-20',
  url: 'https://legiscan.com/LA/bill/HB500/2026',
};

// ---------------------------------------------------------------------------
// classifyBillSeverity
// ---------------------------------------------------------------------------

describe('classifyBillSeverity', () => {
  it('classifies healthcare ban as critical', () => {
    expect(classifyBillSeverity(BILL_TRANS_HEALTHCARE_BAN)).toBe('critical');
  });

  it('classifies felony healthcare criminalization as critical', () => {
    expect(classifyBillSeverity(BILL_FELONY_GENDER_CARE)).toBe('critical');
  });

  it('classifies drag ban with misdemeanor as critical', () => {
    expect(classifyBillSeverity(BILL_CRIMINALIZE_DRAG)).toBe('critical');
  });

  it('classifies hormone ban as critical', () => {
    expect(classifyBillSeverity(BILL_HORMONE_BAN)).toBe('critical');
  });

  it('classifies religious exemption enabling discrimination as critical', () => {
    expect(classifyBillSeverity(BILL_RELIGIOUS_EXEMPTION)).toBe('critical');
  });

  it('classifies bathroom restriction as high', () => {
    expect(classifyBillSeverity(BILL_BATHROOM_RESTRICTION)).toBe('high');
  });

  it('classifies Don\'t Say Gay classroom restriction as high', () => {
    expect(classifyBillSeverity(BILL_DONT_SAY_GAY)).toBe('high');
  });

  it('classifies conversion therapy prohibition (federal) as high', () => {
    // "prohibit.*conversion" triggers high
    expect(classifyBillSeverity(BILL_CONVERSION_THERAPY_BAN)).toBe('high');
  });

  it('classifies parental notification as medium', () => {
    expect(classifyBillSeverity(BILL_PARENTAL_NOTIFICATION)).toBe('medium');
  });

  it('classifies mandatory disclosure as medium', () => {
    expect(classifyBillSeverity(BILL_DISCLOSURE)).toBe('medium');
  });

  it('classifies study committee as low', () => {
    expect(classifyBillSeverity(BILL_STUDY_COMMITTEE)).toBe('low');
  });

  it('classifies a bill with empty title and description as low', () => {
    expect(classifyBillSeverity({ bill_id: 99999, title: '', description: '' })).toBe('low');
  });

  it('handles missing title/description fields gracefully', () => {
    expect(classifyBillSeverity({ bill_id: 99998 })).toBe('low');
  });

  it('is case-insensitive in pattern matching', () => {
    const upperTitle = {
      bill_id: 77777,
      title: 'PROHIBITING GENDER-AFFIRMING CARE',
      description: 'BAN ON ALL GENDER AFFIRMING PROCEDURES',
    };
    expect(classifyBillSeverity(upperTitle)).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// deduplicateBills
// ---------------------------------------------------------------------------

describe('deduplicateBills', () => {
  it('returns an empty array when given an empty array', () => {
    expect(deduplicateBills([])).toEqual([]);
  });

  it('returns same bills when there are no duplicates', () => {
    const bills = [BILL_TRANS_HEALTHCARE_BAN, BILL_BATHROOM_RESTRICTION, BILL_PARENTAL_NOTIFICATION];
    const result = deduplicateBills(bills);
    expect(result).toHaveLength(3);
  });

  it('removes exact duplicate bill_id entries', () => {
    const bills = [
      BILL_TRANS_HEALTHCARE_BAN,
      BILL_TRANS_HEALTHCARE_BAN,   // exact same object (same reference)
      BILL_BATHROOM_RESTRICTION,
    ];
    const result = deduplicateBills(bills);
    expect(result).toHaveLength(2);
  });

  it('removes duplicate bill_id even when other fields differ (first occurrence wins)', () => {
    const original = { ...BILL_TRANS_HEALTHCARE_BAN, title: 'Original Title' };
    const duplicate = { ...BILL_TRANS_HEALTHCARE_BAN, title: 'Duplicate with different title' };
    const result = deduplicateBills([original, duplicate]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Original Title');
  });

  it('handles a scenario where all bills are duplicates of the same id', () => {
    const bills = Array(5).fill(null).map(() => ({ ...BILL_STUDY_COMMITTEE }));
    const result = deduplicateBills(bills);
    expect(result).toHaveLength(1);
  });

  it('preserves all unique bills when each has a distinct bill_id', () => {
    const allBills = [
      BILL_TRANS_HEALTHCARE_BAN,
      BILL_BATHROOM_RESTRICTION,
      BILL_PARENTAL_NOTIFICATION,
      BILL_STUDY_COMMITTEE,
      BILL_CRIMINALIZE_DRAG,
      BILL_CONVERSION_THERAPY_BAN,
      BILL_FELONY_GENDER_CARE,
      BILL_DONT_SAY_GAY,
      BILL_HORMONE_BAN,
      BILL_DISCLOSURE,
      BILL_RELIGIOUS_EXEMPTION,
    ];
    const result = deduplicateBills(allBills);
    expect(result).toHaveLength(11);
  });

  it('simulates multi-query overlap: same bill returned by "transgender" and "bathroom bill" queries', () => {
    // Imagine LegiScan returns BILL_BATHROOM_RESTRICTION for both queries
    const fromTransgenderQuery = [BILL_BATHROOM_RESTRICTION, BILL_PARENTAL_NOTIFICATION];
    const fromBathroomQuery    = [BILL_BATHROOM_RESTRICTION, BILL_STUDY_COMMITTEE];
    const combined = [...fromTransgenderQuery, ...fromBathroomQuery];

    const result = deduplicateBills(combined);
    const ids = result.map(b => b.bill_id);
    expect(ids).toContain(BILL_BATHROOM_RESTRICTION.bill_id);
    expect(ids).toContain(BILL_PARENTAL_NOTIFICATION.bill_id);
    expect(ids).toContain(BILL_STUDY_COMMITTEE.bill_id);
    // Exactly one copy of the shared bill
    expect(ids.filter(id => id === BILL_BATHROOM_RESTRICTION.bill_id)).toHaveLength(1);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Search query coverage
// ---------------------------------------------------------------------------

describe('LEGISCAN_SEARCH_QUERIES coverage', () => {
  const required = [
    'transgender',
    'LGBTQ',
    'sexual orientation',
    'gender identity',
    'drag',
    'bathroom bill',
    'conversion therapy',
    "don't say gay",
  ];

  it('contains all required search terms', () => {
    for (const term of required) {
      expect(LEGISCAN_SEARCH_QUERIES).toContain(term);
    }
  });

  it('has no duplicate search terms', () => {
    const unique = new Set(LEGISCAN_SEARCH_QUERIES);
    expect(unique.size).toBe(LEGISCAN_SEARCH_QUERIES.length);
  });

  it('contains at least 8 search terms', () => {
    expect(LEGISCAN_SEARCH_QUERIES.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Target state coverage
// ---------------------------------------------------------------------------

describe('LEGISCAN_TARGET_STATES coverage', () => {
  const requiredStates = ['FL', 'TX', 'TN', 'OH', 'MO', 'LA', 'IN', 'KY', 'SC', 'GA', 'US'];

  it('contains all required high-priority states plus US federal', () => {
    for (const state of requiredStates) {
      expect(LEGISCAN_TARGET_STATES).toContain(state);
    }
  });

  it('includes US for federal bill tracking', () => {
    expect(LEGISCAN_TARGET_STATES).toContain('US');
  });

  it('has no duplicate state codes', () => {
    const unique = new Set(LEGISCAN_TARGET_STATES);
    expect(unique.size).toBe(LEGISCAN_TARGET_STATES.length);
  });

  it('contains exactly 11 entries (10 states + US federal)', () => {
    expect(LEGISCAN_TARGET_STATES).toHaveLength(11);
  });
});
