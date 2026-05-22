import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('EnvoyReputation', () => {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Reputation = await ethers.getContractFactory('EnvoyReputation');
    const reputation = await Reputation.deploy();
    return { reputation, owner, alice, bob };
  }

  const QUALITY = ethers.id('quality');
  const RELIABILITY = ethers.id('reliability');

  it('attest once and read back', async () => {
    const { reputation, alice } = await deploy();
    await expect(reputation.connect(alice).attest('did:envoy:agent-1', QUALITY, 800, 'ipfs://e1'))
      .to.emit(reputation, 'Attested');

    const all = await reputation.getAttestations('did:envoy:agent-1');
    expect(all.length).to.equal(1);
    expect(all[0].score).to.equal(800);
    expect(all[0].attester).to.equal(alice.address);
  });

  it('one attestation per (attester, category, did) — second call updates', async () => {
    const { reputation, alice } = await deploy();
    await reputation.connect(alice).attest('did:x', QUALITY, 500, '');
    await reputation.connect(alice).attest('did:x', QUALITY, 900, 'evidence-v2');

    const all = await reputation.getAttestations('did:x');
    expect(all.length).to.equal(1);
    expect(all[0].score).to.equal(900);
    expect(all[0].evidenceURI).to.equal('evidence-v2');
  });

  it('different attesters create distinct attestations', async () => {
    const { reputation, alice, bob } = await deploy();
    await reputation.connect(alice).attest('did:y', QUALITY, 700, '');
    await reputation.connect(bob).attest('did:y', QUALITY, 900, '');

    const all = await reputation.getAttestationsByCategory('did:y', QUALITY);
    expect(all.length).to.equal(2);
    expect(await reputation.averageScore('did:y', QUALITY)).to.equal(800);
  });

  it('rejects out-of-range score', async () => {
    const { reputation, alice } = await deploy();
    await expect(
      reputation.connect(alice).attest('did:z', QUALITY, 1001, ''),
    ).to.be.revertedWithCustomError(reputation, 'ScoreOutOfRange');
  });

  it('revoke zeroes out the score and excludes from category list', async () => {
    const { reputation, alice } = await deploy();
    await reputation.connect(alice).attest('did:r', RELIABILITY, 600, '');
    await reputation.connect(alice).revoke('did:r', RELIABILITY);

    const filtered = await reputation.getAttestationsByCategory('did:r', RELIABILITY);
    expect(filtered.length).to.equal(0);
    expect(await reputation.averageScore('did:r', RELIABILITY)).to.equal(0);
  });
});
