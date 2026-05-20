import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

describe('EnvoyEscrow', () => {
  async function deploy() {
    const [owner, payer, recipient, facilitator, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const token = await Token.deploy('Mock cUSD', 'cUSD', 18);
    await token.mint(payer.address, ethers.parseEther('1000'));

    const Escrow = await ethers.getContractFactory('EnvoyEscrow');
    const escrow = await Escrow.deploy(owner.address, facilitator.address);
    return { escrow, token, owner, payer, recipient, facilitator, other };
  }

  function id(s: string) {
    return ethers.id(s);
  }

  async function signRelease(
    escrow: any,
    facilitator: any,
    paymentId: string,
    recipient: string,
    amount: bigint,
    deadline: number,
  ) {
    const domain = {
      name: 'EnvoyEscrow',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await escrow.getAddress(),
    };
    const types = {
      Release: [
        { name: 'paymentId', type: 'bytes32' },
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };
    return facilitator.signTypedData(domain, types, { paymentId, recipient, amount, deadline });
  }

  it('happy path: deposit → release', async () => {
    const { escrow, token, payer, recipient, facilitator } = await deploy();
    const amount = ethers.parseEther('10');
    const paymentId = id('payment-1');
    const expiresAt = (await time.latest()) + 3600;

    await token.connect(payer).approve(await escrow.getAddress(), amount);
    await expect(escrow.connect(payer).deposit(await token.getAddress(), amount, paymentId, expiresAt))
      .to.emit(escrow, 'Deposited');

    const deadline = (await time.latest()) + 600;
    const sig = await signRelease(escrow, facilitator, paymentId, recipient.address, amount, deadline);

    await expect(escrow.release(paymentId, recipient.address, amount, deadline, sig))
      .to.emit(escrow, 'Released')
      .withArgs(paymentId, recipient.address, amount);

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it('partial release returns remainder to payer', async () => {
    const { escrow, token, payer, recipient, facilitator } = await deploy();
    const deposit = ethers.parseEther('10');
    const part = ethers.parseEther('3');
    const paymentId = id('payment-partial');
    const expiresAt = (await time.latest()) + 3600;

    await token.connect(payer).approve(await escrow.getAddress(), deposit);
    await escrow.connect(payer).deposit(await token.getAddress(), deposit, paymentId, expiresAt);

    const payerBefore = await token.balanceOf(payer.address);
    const deadline = (await time.latest()) + 600;
    const sig = await signRelease(escrow, facilitator, paymentId, recipient.address, part, deadline);
    await escrow.release(paymentId, recipient.address, part, deadline, sig);

    expect(await token.balanceOf(recipient.address)).to.equal(part);
    expect(await token.balanceOf(payer.address)).to.equal(payerBefore + (deposit - part));
  });

  it('refund after expiry', async () => {
    const { escrow, token, payer } = await deploy();
    const amount = ethers.parseEther('5');
    const paymentId = id('payment-refund');
    const expiresAt = (await time.latest()) + 60;

    await token.connect(payer).approve(await escrow.getAddress(), amount);
    await escrow.connect(payer).deposit(await token.getAddress(), amount, paymentId, expiresAt);

    await expect(escrow.refund(paymentId)).to.be.revertedWithCustomError(escrow, 'NotExpired');
    await time.increaseTo(expiresAt + 1);

    const before = await token.balanceOf(payer.address);
    await escrow.refund(paymentId);
    expect(await token.balanceOf(payer.address)).to.equal(before + amount);
  });

  it('rejects bad signature', async () => {
    const { escrow, token, payer, recipient, other } = await deploy();
    const amount = ethers.parseEther('1');
    const paymentId = id('payment-bad-sig');
    const expiresAt = (await time.latest()) + 3600;

    await token.connect(payer).approve(await escrow.getAddress(), amount);
    await escrow.connect(payer).deposit(await token.getAddress(), amount, paymentId, expiresAt);

    const deadline = (await time.latest()) + 600;
    // `other` is NOT the facilitator
    const sig = await signRelease(escrow, other, paymentId, recipient.address, amount, deadline);

    await expect(
      escrow.release(paymentId, recipient.address, amount, deadline, sig),
    ).to.be.revertedWithCustomError(escrow, 'InvalidSignature');
  });

  it('rejects expired deadline', async () => {
    const { escrow, token, payer, recipient, facilitator } = await deploy();
    const amount = ethers.parseEther('1');
    const paymentId = id('payment-late');
    const expiresAt = (await time.latest()) + 3600;

    await token.connect(payer).approve(await escrow.getAddress(), amount);
    await escrow.connect(payer).deposit(await token.getAddress(), amount, paymentId, expiresAt);

    const deadline = (await time.latest()) - 1;
    const sig = await signRelease(escrow, facilitator, paymentId, recipient.address, amount, deadline);

    await expect(
      escrow.release(paymentId, recipient.address, amount, deadline, sig),
    ).to.be.revertedWithCustomError(escrow, 'DeadlinePassed');
  });
});
