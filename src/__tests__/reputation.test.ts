/**
 * Tests for Reputation — EAS-style attestation scoring (ERC-8004 Reputation
 * Registry concept).
 */

import { Reputation } from '../identity/reputation';
import { AgentDID, CreateAttestationOptions } from '../identity/types';

const SUBJECT = 'did:asg:agent:eip155:8453:0xSubject' as AgentDID;
const ATTESTER = '0xAttester';

const opt = (over: Partial<CreateAttestationOptions> = {}): CreateAttestationOptions => ({
  subject: SUBJECT,
  score: 90,
  category: 'payment-reliability',
  ...over,
});

describe('Reputation', () => {
  let rep: Reputation;
  beforeEach(() => {
    rep = new Reputation();
  });

  describe('attest()', () => {
    it('creates and stores an attestation', () => {
      const a = rep.attest(ATTESTER, opt());
      expect(a.attester).toBe(ATTESTER);
      expect(a.subject).toBe(SUBJECT);
      expect(a.score).toBe(90);
      expect(a.isValid).toBe(true);
      expect(a.id).toMatch(/^att_/);
      expect(rep.getAttestationCount(SUBJECT)).toBe(1);
    });

    it('rejects out-of-range scores', () => {
      expect(() => rep.attest(ATTESTER, opt({ score: -1 }))).toThrow('between 0 and 100');
      expect(() => rep.attest(ATTESTER, opt({ score: 101 }))).toThrow('between 0 and 100');
    });

    it('sets expiresAt when validFor is given', () => {
      const a = rep.attest(ATTESTER, opt({ validFor: 60_000 }));
      expect(a.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('getValidAttestations()', () => {
    it('excludes revoked attestations but keeps them in the full list', () => {
      const a = rep.attest(ATTESTER, opt());
      expect(rep.getValidAttestations(SUBJECT)).toHaveLength(1);
      expect(rep.revoke(SUBJECT, a.id)).toBe(true);
      expect(rep.getValidAttestations(SUBJECT)).toHaveLength(0);
      expect(rep.getAllAttestations(SUBJECT)).toHaveLength(1);
    });

    it('excludes expired attestations', () => {
      rep.attest(ATTESTER, opt({ validFor: -1000 })); // expiresAt already in the past
      expect(rep.getValidAttestations(SUBJECT)).toHaveLength(0);
    });

    it('returns [] for an unknown subject', () => {
      expect(rep.getValidAttestations('did:asg:agent:eip155:8453:0xNone')).toEqual([]);
    });
  });

  describe('revoke()', () => {
    it('returns false for an unknown subject or attestation id', () => {
      expect(rep.revoke('did:asg:agent:eip155:8453:0xNone', 'x')).toBe(false);
      rep.attest(ATTESTER, opt());
      expect(rep.revoke(SUBJECT, 'missing-id')).toBe(false);
    });
  });

  describe('getProfile()', () => {
    it('returns an empty profile when there are no attestations', () => {
      const p = rep.getProfile(SUBJECT);
      expect(p.overallScore).toBe(0);
      expect(p.totalAttestations).toBe(0);
      expect(p.successRate).toBe(0);
      expect(p.recentAttestations).toEqual([]);
    });

    it('aggregates scores, success rate, and the category breakdown', () => {
      rep.attest(ATTESTER, opt({ score: 80, category: 'payment-reliability' }));
      rep.attest(ATTESTER, opt({ score: 90, category: 'payment-reliability' }));
      rep.attest(ATTESTER, opt({ score: 40, category: 'task-quality' }));
      const p = rep.getProfile(SUBJECT);

      expect(p.totalAttestations).toBe(3);
      expect(p.categoryScores['payment-reliability']).toBe(85); // avg(80, 90)
      expect(p.categoryScores['task-quality']).toBe(40);
      expect(p.totalTransactions).toBe(2); // payment-reliability attestations
      expect(p.successRate).toBe(0.67); // 2 of 3 score >= 70
      expect(p.overallScore).toBeGreaterThan(0);
      expect(p.overallScore).toBeLessThanOrEqual(100);
    });

    it('keeps only the 10 most recent in recentAttestations', () => {
      for (let i = 0; i < 12; i++) rep.attest(ATTESTER, opt({ score: 75 }));
      const p = rep.getProfile(SUBJECT);
      expect(p.totalAttestations).toBe(12);
      expect(p.recentAttestations).toHaveLength(10);
    });
  });

  describe('getScore() / meetsThreshold()', () => {
    it('derive from the aggregated profile', () => {
      rep.attest(ATTESTER, opt({ score: 90, category: 'payment-reliability' }));
      expect(rep.getScore(SUBJECT)).toBe(90);
      expect(rep.meetsThreshold(SUBJECT, 80)).toBe(true);
      expect(rep.meetsThreshold(SUBJECT, 95)).toBe(false);
    });
  });

  describe('getAttestationCount()', () => {
    it('counts only valid attestations', () => {
      const a = rep.attest(ATTESTER, opt());
      rep.attest(ATTESTER, opt({ score: 50 }));
      expect(rep.getAttestationCount(SUBJECT)).toBe(2);
      rep.revoke(SUBJECT, a.id);
      expect(rep.getAttestationCount(SUBJECT)).toBe(1);
      expect(rep.getAllAttestations(SUBJECT)).toHaveLength(2);
    });
  });
});
