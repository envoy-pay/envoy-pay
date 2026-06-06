/**
 * Tests for OwnerRegistry — agent↔owner binding + delegation levels (ERC-8004
 * Validation Registry concept).
 */

import { OwnerRegistry } from '../identity/owner-registry';
import { AgentDID } from '../identity/types';

const A1 = 'did:asg:agent:eip155:8453:0xA1' as AgentDID;
const A2 = 'did:asg:agent:eip155:8453:0xA2' as AgentDID;
const OWNER = '0xOwner1';
const OWNER2 = '0xOwner2';

describe('OwnerRegistry', () => {
  let reg: OwnerRegistry;
  beforeEach(() => {
    reg = new OwnerRegistry();
  });

  describe('register()', () => {
    it('binds an agent to an owner with a default supervised level', () => {
      const rec = reg.register(A1, OWNER);
      expect(rec.agentDid).toBe(A1);
      expect(rec.ownerAddress).toBe(OWNER);
      expect(rec.delegationLevel).toBe('supervised');
      expect(rec.since).toBeInstanceOf(Date);
    });

    it('honors an explicit delegation level and metadata', () => {
      const rec = reg.register(A1, OWNER, 'full', { label: 'bot' });
      expect(rec.delegationLevel).toBe('full');
      expect(rec.metadata).toEqual({ label: 'bot' });
    });

    it('throws when the agent DID or owner is missing', () => {
      expect(() => reg.register('' as AgentDID, OWNER)).toThrow();
      expect(() => reg.register(A1, '')).toThrow();
    });

    it('indexes the agent under its owner', () => {
      reg.register(A1, OWNER);
      reg.register(A2, OWNER);
      expect(reg.getAgentsByOwner(OWNER)).toHaveLength(2);
    });
  });

  describe('getOwner() / isOwner()', () => {
    it('returns the record or null', () => {
      reg.register(A1, OWNER);
      expect(reg.getOwner(A1)?.ownerAddress).toBe(OWNER);
      expect(reg.getOwner(A2)).toBeNull();
    });

    it('isOwner reflects the binding', () => {
      reg.register(A1, OWNER);
      expect(reg.isOwner(A1, OWNER)).toBe(true);
      expect(reg.isOwner(A1, OWNER2)).toBe(false);
      expect(reg.isOwner(A2, OWNER)).toBe(false);
    });
  });

  describe('getAgentsByOwner()', () => {
    it('returns [] for an unknown owner', () => {
      expect(reg.getAgentsByOwner('0xNobody')).toEqual([]);
    });
  });

  describe('delegation levels', () => {
    it('reads and updates the delegation level', () => {
      reg.register(A1, OWNER, 'supervised');
      expect(reg.getDelegationLevel(A1)).toBe('supervised');
      expect(reg.setDelegationLevel(A1, 'restricted')).toBe(true);
      expect(reg.getDelegationLevel(A1)).toBe('restricted');
    });

    it('setDelegationLevel returns false for an unknown agent', () => {
      expect(reg.setDelegationLevel(A1, 'full')).toBe(false);
    });

    it('getDelegationLevel returns null for an unknown agent', () => {
      expect(reg.getDelegationLevel(A1)).toBeNull();
    });

    it('canTransact is false only for readonly / unknown agents', () => {
      reg.register(A1, OWNER, 'readonly');
      expect(reg.canTransact(A1)).toBe(false);
      reg.setDelegationLevel(A1, 'full');
      expect(reg.canTransact(A1)).toBe(true);
      expect(reg.canTransact(A2)).toBe(false);
    });

    it('requiresApproval only for the restricted level', () => {
      reg.register(A1, OWNER, 'restricted');
      expect(reg.requiresApproval(A1)).toBe(true);
      reg.setDelegationLevel(A1, 'full');
      expect(reg.requiresApproval(A1)).toBe(false);
    });
  });

  describe('transferOwnership()', () => {
    it('moves the agent to the new owner and reindexes both sides', () => {
      reg.register(A1, OWNER);
      expect(reg.transferOwnership(A1, OWNER2)).toBe(true);
      expect(reg.isOwner(A1, OWNER2)).toBe(true);
      expect(reg.getAgentsByOwner(OWNER)).toHaveLength(0);
      expect(reg.getAgentsByOwner(OWNER2)).toHaveLength(1);
    });

    it('returns false for an unknown agent', () => {
      expect(reg.transferOwnership(A1, OWNER2)).toBe(false);
    });
  });

  describe('unregister()', () => {
    it('removes the binding and its index entry', () => {
      reg.register(A1, OWNER);
      expect(reg.unregister(A1)).toBe(true);
      expect(reg.getOwner(A1)).toBeNull();
      expect(reg.getAgentsByOwner(OWNER)).toHaveLength(0);
      expect(reg.getAgentCount()).toBe(0);
    });

    it('returns false for an unknown agent', () => {
      expect(reg.unregister(A1)).toBe(false);
    });
  });

  describe('getAgentCount()', () => {
    it('counts registered agents', () => {
      expect(reg.getAgentCount()).toBe(0);
      reg.register(A1, OWNER);
      reg.register(A2, OWNER2);
      expect(reg.getAgentCount()).toBe(2);
    });
  });
});
