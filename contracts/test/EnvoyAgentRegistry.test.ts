import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('EnvoyAgentRegistry', () => {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('EnvoyAgentRegistry');
    const registry = await Registry.deploy();
    return { registry, owner, alice, bob };
  }

  it('registers a new agent', async () => {
    const { registry, alice } = await deploy();
    const did = 'did:envoy:alice-001';
    await expect(
      registry.connect(alice).registerAgent(did, alice.address, 'ipfs://card'),
    )
      .to.emit(registry, 'AgentRegistered')
      .withArgs(did, alice.address, 'ipfs://card');

    const [owner, uri, revoked] = await registry.getAgent(did);
    expect(owner).to.equal(alice.address);
    expect(uri).to.equal('ipfs://card');
    expect(revoked).to.equal(false);
    expect(await registry.isActive(did)).to.equal(true);
  });

  it('rejects double-registration of same DID', async () => {
    const { registry, alice, bob } = await deploy();
    await registry.connect(alice).registerAgent('did:dup', alice.address, '');
    await expect(
      registry.connect(bob).registerAgent('did:dup', bob.address, ''),
    ).to.be.revertedWithCustomError(registry, 'AgentAlreadyExists');
  });

  it('only owner can update metadata', async () => {
    const { registry, alice, bob } = await deploy();
    const did = 'did:envoy:b';
    await registry.connect(alice).registerAgent(did, alice.address, 'v1');

    await expect(
      registry.connect(bob).updateAgent(did, 'v2'),
    ).to.be.revertedWithCustomError(registry, 'NotAgentOwner');

    await expect(registry.connect(alice).updateAgent(did, 'v2'))
      .to.emit(registry, 'AgentUpdated')
      .withArgs(did, 'v2');
  });

  it('revoked agent is no longer active but still queryable', async () => {
    const { registry, alice } = await deploy();
    const did = 'did:envoy:rev';
    await registry.connect(alice).registerAgent(did, alice.address, '');
    await registry.connect(alice).revokeAgent(did);

    expect(await registry.isActive(did)).to.equal(false);
    const [, , revoked] = await registry.getAgent(did);
    expect(revoked).to.equal(true);
  });

  it('transfers ownership', async () => {
    const { registry, alice, bob } = await deploy();
    const did = 'did:envoy:xfer';
    await registry.connect(alice).registerAgent(did, alice.address, '');
    await expect(registry.connect(alice).transferAgentOwnership(did, bob.address))
      .to.emit(registry, 'AgentOwnerTransferred')
      .withArgs(did, alice.address, bob.address);
    const [newOwner] = await registry.getAgent(did);
    expect(newOwner).to.equal(bob.address);
  });

  it('rejects update by previous owner after transfer', async () => {
    const { registry, alice, bob } = await deploy();
    const did = 'did:envoy:xfer2';
    await registry.connect(alice).registerAgent(did, alice.address, '');
    await registry.connect(alice).transferAgentOwnership(did, bob.address);
    await expect(
      registry.connect(alice).updateAgent(did, 'v2'),
    ).to.be.revertedWithCustomError(registry, 'NotAgentOwner');
  });

  it('reverts on lookup of unknown DID', async () => {
    const { registry } = await deploy();
    await expect(registry.getAgent('nope')).to.be.revertedWithCustomError(registry, 'AgentNotFound');
  });
});
