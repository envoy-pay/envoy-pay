/**
 * Tests for AgentIdentity — the identity-layer facade that wires DIDResolver,
 * AgentCard, Reputation, and OwnerRegistry into one object.
 */

import { AgentIdentity } from '../identity/agent-identity';
import { AgentDID, AgentIdentityOptions } from '../identity/types';

const baseOptions = (): AgentIdentityOptions => ({
  metadata: {
    name: 'Trading Bot Alpha',
    version: '1.0.0',
    capabilities: ['trade', 'analyze'],
    owner: '0xOwner',
  },
  signerAddress: '0xAgent1',
  signerChainId: 'eip155:8453',
});

describe('AgentIdentity', () => {
  let identity: AgentIdentity;
  beforeEach(() => {
    identity = new AgentIdentity(baseOptions());
  });

  describe('construction', () => {
    it('creates a DID, document, card, and ownership record', () => {
      expect(identity.getDID()).toBe('did:asg:agent:eip155:8453:0xAgent1');
      expect(identity.didDocument.controller).toBe('0xOwner');
      expect(identity.getCard().name).toBe('Trading Bot Alpha');
      expect(identity.getOwner()?.ownerAddress).toBe('0xOwner');
      expect(identity.getDelegationLevel()).toBe('supervised');
      expect(identity.canTransact()).toBe(true);
    });

    it('invokes the optional logger', () => {
      const logs: string[] = [];
      new AgentIdentity({ ...baseOptions(), logger: (m) => logs.push(m) });
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('capabilities', () => {
    it('reports declared capabilities', () => {
      expect(identity.hasCapability('trade')).toBe(true);
      expect(identity.hasCapability('fly')).toBe(false);
    });
  });

  describe('reputation', () => {
    it('starts at zero and updates after a self-attestation', () => {
      expect(identity.getReputationScore()).toBe(0);
      expect(identity.getReputationProfile().totalAttestations).toBe(0);
      expect(identity.meetsThreshold(1)).toBe(false);

      identity.attestAgent({
        subject: identity.getDID(),
        score: 88,
        category: 'payment-reliability',
      });

      expect(identity.getReputationScore()).toBe(88);
      expect(identity.meetsThreshold(80)).toBe(true);
      expect(identity.getReputationProfile().totalAttestations).toBe(1);
    });
  });

  describe('resolveAgent()', () => {
    it('resolves a known DID with reputation + ownership', () => {
      const resolved = identity.resolveAgent(identity.getDID());
      expect(resolved).not.toBeNull();
      expect(resolved!.did.id).toBe(identity.getDID());
      expect(resolved!.reputation).toBeDefined();
      expect(resolved!.ownership).toBeDefined();
    });

    it('honors the include flags', () => {
      const resolved = identity.resolveAgent(identity.getDID(), {
        includeReputation: false,
        includeOwnership: false,
      });
      expect(resolved!.reputation).toBeUndefined();
      expect(resolved!.ownership).toBeUndefined();
    });

    it('returns null for an unknown DID', () => {
      expect(
        identity.resolveAgent('did:asg:agent:eip155:8453:0xGhost' as AgentDID),
      ).toBeNull();
    });
  });

  describe('toJSON()', () => {
    it('exports a portable snapshot', () => {
      const json = identity.toJSON();
      expect(json.did).toBe(identity.getDID());
      expect(json.didDocument).toBeDefined();
      expect(json.card).toBeDefined();
      expect(json.reputation).toBeDefined();
      expect(json.ownership).toBeDefined();
    });
  });
});
