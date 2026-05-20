import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

describe('EnvoyPolicyGuard', () => {
  async function deploy() {
    const [owner, agent, recipient, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const token = await Token.deploy('Mock cUSD', 'cUSD', 18);
    await token.mint(agent.address, ethers.parseEther('1000'));

    const Guard = await ethers.getContractFactory('EnvoyPolicyGuard');
    const guard = await Guard.deploy();
    return { guard, token, owner, agent, recipient, other };
  }

  it('owner can set a daily limit', async () => {
    const { guard, token, owner, agent } = await deploy();
    await expect(
      guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('100')),
    )
      .to.emit(guard, 'PolicySet')
      .withArgs(agent.address, await token.getAddress(), owner.address, ethers.parseEther('100'));
  });

  it('spend within limit succeeds; over-limit reverts', async () => {
    const { guard, token, owner, agent, recipient } = await deploy();
    await guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('50'));
    await token.connect(agent).approve(await guard.getAddress(), ethers.parseEther('100'));

    await expect(
      guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('30'), recipient.address),
    ).to.emit(guard, 'Spent');

    expect(await token.balanceOf(recipient.address)).to.equal(ethers.parseEther('30'));

    await expect(
      guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('30'), recipient.address),
    ).to.be.revertedWithCustomError(guard, 'DailyLimitExceeded');
  });

  it('cap resets after 24h window', async () => {
    const { guard, token, owner, agent, recipient } = await deploy();
    await guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('10'));
    await token.connect(agent).approve(await guard.getAddress(), ethers.parseEther('1000'));

    await guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('10'), recipient.address);
    await expect(
      guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('1'), recipient.address),
    ).to.be.revertedWithCustomError(guard, 'DailyLimitExceeded');

    await time.increase(86_401);
    await expect(
      guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('10'), recipient.address),
    ).to.emit(guard, 'Spent');
  });

  it('only owner can update or revoke', async () => {
    const { guard, token, owner, agent, other } = await deploy();
    await guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('10'));
    await expect(
      guard.connect(other).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('999')),
    ).to.be.revertedWithCustomError(guard, 'NotPolicyOwner');
    await expect(
      guard.connect(other).revokePolicy(agent.address, await token.getAddress()),
    ).to.be.revertedWithCustomError(guard, 'NotPolicyOwner');
  });

  it('non-agent caller cannot spend', async () => {
    const { guard, token, owner, agent, recipient, other } = await deploy();
    await guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('10'));
    await token.connect(agent).approve(await guard.getAddress(), ethers.parseEther('10'));

    await expect(
      guard.connect(other).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('1'), recipient.address),
    ).to.be.revertedWith('envoy: caller must be agent');
  });

  it('revoked policy blocks further spends', async () => {
    const { guard, token, owner, agent, recipient } = await deploy();
    await guard.connect(owner).setPolicy(agent.address, await token.getAddress(), ethers.parseEther('10'));
    await token.connect(agent).approve(await guard.getAddress(), ethers.parseEther('10'));
    await guard.connect(owner).revokePolicy(agent.address, await token.getAddress());

    await expect(
      guard.connect(agent).checkAndSpend(agent.address, await token.getAddress(), ethers.parseEther('1'), recipient.address),
    ).to.be.revertedWithCustomError(guard, 'PolicyInactive');
  });
});
