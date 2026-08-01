/**
 * profile.test.ts — single source of truth for the owner identity.
 *
 * Tests pin the NDA-safe values (location, contact, alumni, awards).
 * Per CLAUDE.md §6, any mention of NDA-protected employers is a hard
 * ship-block. These tests are the line of defense: change the profile,
 * the test catches a leak.
 */
import { describe, it, expect } from 'vitest';
import { profile, archSafe } from '@utils/profile';

// NDA-banned substrings — must never appear in public artifacts.
const NDA_BANNED = [
  '19V Capital',
  'Macion Capital',
  'Arclion AI',
  'Quantivo',
  'CallRank',
  'Davao City', // must be "Digos City, Davao del Sur"
];

describe('profile — NDA-safe identity', () => {
  it('contains no NDA-banned employer strings', () => {
    const haystack = JSON.stringify(profile);
    for (const banned of NDA_BANNED) {
      expect(haystack, `profile leaks "${banned}"`).not.toContain(banned);
    }
  });

  it('lists Digos City (not Davao City) as the location', () => {
    expect(profile.location.city).toBe('Digos City');
    expect(profile.location.province).toBe('Davao del Sur');
    expect(profile.location.display).toContain('Digos City');
  });

  it('carries timezone UTC+8', () => {
    expect(profile.location.timezone).toBe('UTC+8');
  });

  it('has a complete contact block', () => {
    expect(profile.contact.email).toMatch(/@/);
    expect(profile.contact.linkedin).toMatch(/^https:\/\/www\.linkedin\.com\//);
    expect(profile.contact.github).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('profile — chrome derivation invariants', () => {
  it('keeps aiAgentCount, evalGates, locPython, certCount in sync with chrome', () => {
    // The `secondary` title derives these from stats.* — if any drift,
    // chrome becomes inconsistent.
    const sec = profile.titles.secondary;
    expect(sec).toContain(profile.stats.aiAgentCount);
    expect(sec).toContain(profile.stats.evalGates);
    expect(sec).toContain(profile.stats.locPython);
    expect(sec).toContain(profile.stats.certCount);
  });

  it('positions start date is ISO YYYY-MM-DD', () => {
    expect(profile.stats.positionsStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resumeCount reflects the 3-variant resume split', () => {
    expect(profile.stats.resumeCount).toBe('3');
  });
});

describe('profile — award chrome', () => {
  it('lists certifications as a range (not present tense)', () => {
    const awards = profile.awards ?? [];
    const certAward = awards.find((a) => /certificates/.test(a));
    expect(certAward, 'cert award missing').toBeDefined();
    expect(certAward).toMatch(/\d{4}-\d{2}\s*→\s*\d{4}-\d{2}/);
  });
});

describe('archSafe — public-safe multi-agent office chrome', () => {
  it('contains no NDA-banned employer strings', () => {
    const haystack = JSON.stringify(archSafe);
    for (const banned of NDA_BANNED) {
      expect(haystack, `archSafe leaks "${banned}"`).not.toContain(banned);
    }
  });

  it('exposes 4 math doctrine pillars (stochastic/dynamical/numerical PDE/stat-learn)', () => {
    expect(archSafe.mathDoctrine).toHaveLength(4);
    expect(archSafe.mathDoctrine).toContain('stochastic analysis');
    expect(archSafe.mathDoctrine).toContain('dynamical systems');
    expect(archSafe.mathDoctrine).toContain('numerical PDE');
    expect(archSafe.mathDoctrine).toContain('statistical learning theory');
  });

  it('exposes 5-must-have rubric', () => {
    expect(archSafe.mustHave).toHaveLength(5);
    const tags = archSafe.mustHave.map((m) => m.tag);
    expect(tags).toContain('eval-first');
    expect(tags).toContain('NDA-clean');
    expect(tags).toContain('alpha-driven');
    expect(tags).toContain('ship-ready');
    expect(tags).toContain('tier-aware');
  });

  it('agentCount + subTeamCount + mathDoctrineCount agree with the arrays', () => {
    expect(archSafe.agentCount).toBe(profile.stats.agentOfficeCount);
    expect(archSafe.subTeamCount).toBe(profile.stats.subTeamCount);
    expect(archSafe.mathDoctrineCount).toBe(profile.stats.mathDoctrineCount);
  });
});