import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import type { HDNodeWallet } from 'ethers';

// EIP-712 typed-data shape — mirror of the on-chain PaymentAuth struct.
const PAYMENT_AUTH_TYPES = {
  PaymentAuth: [
    { name: 'agentId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'challengeId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

const CHALLENGE = (s: string) => ethers.id(`challenge:${s}`);

describe('EnvoyFacilitator', () => {
  const FEE_BPS = 25; // 0.25 %
  const DAY = 24 * 60 * 60;

  async function deploy() {
    const [deployer, owner, treasury, agentEOA, merchant, attacker, otherOwner] =
      await ethers.getSigners();

    const Identity = await ethers.getContractFactory('MockIdentityRegistry');
    const identity = await Identity.deploy();

    const Token = await ethers.getContractFactory('MockERC20');
    const token = await Token.deploy('Mock cKES', 'cKES', 18);

    const Facilitator = await ethers.getContractFactory('EnvoyFacilitator');
    const facilitator = await Facilitator.deploy(
      await identity.getAddress(),
      FEE_BPS,
      treasury.address,
      owner.address,
    );

    return {
      identity,
      token,
      facilitator,
      deployer,
      owner,
      treasury,
      agentEOA,
      merchant,
      attacker,
      otherOwner,
    };
  }

  async function domain(facilitator: any) {
    return {
      name: 'EnvoyFacilitator',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await facilitator.getAddress(),
    };
  }

  async function signAuth(
    facilitator: any,
    signer: HDNodeWallet | any,
    auth: {
      agentId: bigint;
      token: string;
      merchant: string;
      amount: bigint;
      challengeId: string;
      nonce: bigint;
      deadline: number;
    },
  ) {
    return signer.signTypedData(await domain(facilitator), PAYMENT_AUTH_TYPES, auth);
  }

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  describe('constructor', () => {
    it('stores immutables and seeds treasury', async () => {
      const { facilitator, identity, treasury } = await deploy();
      expect(await facilitator.IDENTITY()).to.equal(await identity.getAddress());
      expect(await facilitator.feeBps()).to.equal(FEE_BPS);
      expect(await facilitator.treasury()).to.equal(treasury.address);
      expect(await facilitator.MAX_FEE_BPS()).to.equal(200);
    });

    it('rejects fee above MAX_FEE_BPS', async () => {
      const [, owner, treasury] = await ethers.getSigners();
      const Identity = await ethers.getContractFactory('MockIdentityRegistry');
      const identity = await Identity.deploy();
      const Facilitator = await ethers.getContractFactory('EnvoyFacilitator');
      await expect(
        Facilitator.deploy(await identity.getAddress(), 201, treasury.address, owner.address),
      )
        .to.be.revertedWithCustomError(Facilitator, 'FeeTooHigh')
        .withArgs(201, 200);
    });

    it('rejects zero identity registry or treasury', async () => {
      const [, owner, treasury] = await ethers.getSigners();
      const Identity = await ethers.getContractFactory('MockIdentityRegistry');
      const identity = await Identity.deploy();
      const Facilitator = await ethers.getContractFactory('EnvoyFacilitator');
      await expect(
        Facilitator.deploy(ethers.ZeroAddress, FEE_BPS, treasury.address, owner.address),
      ).to.be.revertedWithCustomError(Facilitator, 'InvalidAddress');
      await expect(
        Facilitator.deploy(await identity.getAddress(), FEE_BPS, ethers.ZeroAddress, owner.address),
      ).to.be.revertedWithCustomError(Facilitator, 'InvalidAddress');
    });
  });

  // ---------------------------------------------------------------------
  // setLimit / disableLimit
  // ---------------------------------------------------------------------

  describe('setLimit', () => {
    const AGENT_ID = 7n;

    it('lets the agent NFT owner set a policy', async () => {
      const { facilitator, identity, token, agentEOA, otherOwner } = await deploy();
      // otherOwner holds the agent NFT; agentEOA is the operational signing wallet.
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);

      await expect(
        facilitator
          .connect(otherOwner)
          .setLimit(AGENT_ID, await token.getAddress(), ethers.parseEther('1'), ethers.parseEther('10'), DAY),
      )
        .to.emit(facilitator, 'LimitSet')
        .withArgs(AGENT_ID, await token.getAddress(), ethers.parseEther('1'), ethers.parseEther('10'), DAY);

      const L = await facilitator.getLimit(AGENT_ID, await token.getAddress());
      expect(L.enabled).to.equal(true);
      expect(L.perTx).to.equal(ethers.parseEther('1'));
      expect(L.perPeriod).to.equal(ethers.parseEther('10'));
      expect(L.periodLen).to.equal(DAY);
    });

    it('rejects callers that are neither owner nor approved operator', async () => {
      const { facilitator, identity, token, agentEOA, otherOwner, attacker } = await deploy();
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);

      await expect(
        facilitator
          .connect(attacker)
          .setLimit(AGENT_ID, await token.getAddress(), 1n, 1n, DAY),
      ).to.be.revertedWithCustomError(facilitator, 'NotAuthorizedForAgent');
    });

    it('respects ERC-721 operator approvals from the canonical registry', async () => {
      const { facilitator, identity, token, otherOwner, attacker, agentEOA } = await deploy();
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);
      await identity.approve(AGENT_ID, attacker.address, true);

      await expect(
        facilitator
          .connect(attacker)
          .setLimit(AGENT_ID, await token.getAddress(), 1n, 1n, DAY),
      ).to.emit(facilitator, 'LimitSet');
    });

    it('rejects nonsensical limits', async () => {
      const { facilitator, identity, token, otherOwner, agentEOA } = await deploy();
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);
      const addr = await token.getAddress();

      await expect(
        facilitator.connect(otherOwner).setLimit(AGENT_ID, addr, 0n, 1n, DAY),
      ).to.be.revertedWithCustomError(facilitator, 'ZeroLimit');
      await expect(
        facilitator.connect(otherOwner).setLimit(AGENT_ID, addr, 1n, 0n, DAY),
      ).to.be.revertedWithCustomError(facilitator, 'ZeroLimit');
      await expect(
        facilitator
          .connect(otherOwner)
          .setLimit(AGENT_ID, addr, ethers.parseEther('2'), ethers.parseEther('1'), DAY),
      ).to.be.revertedWithCustomError(facilitator, 'PerPeriodLessThanPerTx');
      await expect(
        facilitator.connect(otherOwner).setLimit(AGENT_ID, addr, 1n, 1n, 0),
      ).to.be.revertedWithCustomError(facilitator, 'BadPeriod');
    });

    it('disableLimit gates further payments until reset', async () => {
      const { facilitator, identity, token, otherOwner, agentEOA } = await deploy();
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);
      const addr = await token.getAddress();
      await facilitator
        .connect(otherOwner)
        .setLimit(AGENT_ID, addr, ethers.parseEther('1'), ethers.parseEther('5'), DAY);

      await expect(facilitator.connect(otherOwner).disableLimit(AGENT_ID, addr))
        .to.emit(facilitator, 'LimitDisabled')
        .withArgs(AGENT_ID, addr);

      const L = await facilitator.getLimit(AGENT_ID, addr);
      expect(L.enabled).to.equal(false);
    });
  });

  // ---------------------------------------------------------------------
  // pay — happy path + invariants
  // ---------------------------------------------------------------------

  describe('pay', () => {
    const AGENT_ID = 42n;

    async function setup() {
      const ctx = await deploy();
      const { facilitator, identity, token, agentEOA, otherOwner, merchant } = ctx;
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);
      await facilitator
        .connect(otherOwner)
        .setLimit(
          AGENT_ID,
          await token.getAddress(),
          ethers.parseEther('10'),
          ethers.parseEther('100'),
          DAY,
        );
      await token.mint(agentEOA.address, ethers.parseEther('1000'));
      await token.connect(agentEOA).approve(await facilitator.getAddress(), ethers.MaxUint256);
      return { ...ctx, addr: await token.getAddress() };
    }

    it('settles atomically and splits net + fee correctly', async () => {
      const { facilitator, token, agentEOA, merchant, treasury, addr } = await setup();
      const amount = ethers.parseEther('4');
      const challengeId = CHALLENGE('happy');
      const nonce = 1n;
      const deadline = (await time.latest()) + 3600;

      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount,
        challengeId,
        nonce,
        deadline,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);

      const expectedFee = (amount * BigInt(FEE_BPS)) / 10_000n;
      const expectedNet = amount - expectedFee;

      await expect(facilitator.pay(auth, sig))
        .to.emit(facilitator, 'Settled')
        .withArgs(
          challengeId,
          AGENT_ID,
          merchant.address,
          addr,
          amount,
          expectedFee,
          nonce,
          agentEOA.address,
        );

      expect(await token.balanceOf(merchant.address)).to.equal(expectedNet);
      expect(await token.balanceOf(treasury.address)).to.equal(expectedFee);
      expect(await facilitator.isNonceUsed(AGENT_ID, nonce)).to.equal(true);

      const L = await facilitator.getLimit(AGENT_ID, addr);
      expect(L.spentInPeriod).to.equal(amount);
    });

    it('skips treasury transfer when fee rounds to zero', async () => {
      // amount * 25 / 10_000 == 0  ⇔  amount < 400
      const { facilitator, token, agentEOA, merchant, treasury, addr } = await setup();
      // shrink perTx so we can pay sub-unit amounts
      const { otherOwner } = await setup();
      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: 1n, // 1 wei → fee = 0
        challengeId: CHALLENGE('tiny'),
        nonce: 2n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);
      const treasuryBefore = await token.balanceOf(treasury.address);
      await facilitator.pay(auth, sig);
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore);
      expect(await token.balanceOf(merchant.address)).to.equal(1n);
    });

    it('rejects an expired auth', async () => {
      const { facilitator, agentEOA, merchant, addr } = await setup();
      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('expired'),
        nonce: 3n,
        deadline: (await time.latest()) - 1,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);
      await expect(facilitator.pay(auth, sig)).to.be.revertedWithCustomError(
        facilitator,
        'AuthExpired',
      );
    });

    it('rejects when signer ≠ getAgentWallet(agentId)', async () => {
      const { facilitator, attacker, merchant, addr } = await setup();
      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('wrong-signer'),
        nonce: 4n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, attacker, auth);
      await expect(facilitator.pay(auth, sig)).to.be.revertedWithCustomError(
        facilitator,
        'BadSigner',
      );
    });

    it('rejects when no agentWallet is set (e.g. just after NFT transfer)', async () => {
      const { facilitator, identity, agentEOA, merchant, addr } = await setup();
      // Simulate NFT transfer wiping the canonical agentWallet
      await identity.transferAgent(AGENT_ID, ethers.Wallet.createRandom().address);

      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('no-wallet'),
        nonce: 5n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);
      await expect(facilitator.pay(auth, sig)).to.be.revertedWithCustomError(
        facilitator,
        'NoAgentWallet',
      );
    });

    it('rejects nonce reuse', async () => {
      const { facilitator, agentEOA, merchant, addr } = await setup();
      const baseAuth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('first'),
        nonce: 99n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, baseAuth);
      await facilitator.pay(baseAuth, sig);

      // Same nonce, different challenge — must still be rejected.
      const second = { ...baseAuth, challengeId: CHALLENGE('second') };
      const sig2 = await signAuth(facilitator, agentEOA, second);
      await expect(facilitator.pay(second, sig2)).to.be.revertedWithCustomError(
        facilitator,
        'NonceAlreadyUsed',
      );
    });

    it('rejects per-tx exceed', async () => {
      const { facilitator, agentEOA, merchant, addr } = await setup();
      const tooBig = ethers.parseEther('11'); // perTx is 10
      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: tooBig,
        challengeId: CHALLENGE('big'),
        nonce: 100n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);
      await expect(facilitator.pay(auth, sig))
        .to.be.revertedWithCustomError(facilitator, 'PerTxExceeded')
        .withArgs(tooBig, ethers.parseEther('10'));
    });

    it('rejects per-period exceed across multiple pays', async () => {
      const { facilitator, agentEOA, merchant, addr } = await setup();
      // perPeriod = 100 ether; perTx = 10 ether. 10 pays of 10 ether = 100; 11th should revert.
      for (let i = 0; i < 10; i++) {
        const auth = {
          agentId: AGENT_ID,
          token: addr,
          merchant: merchant.address,
          amount: ethers.parseEther('10'),
          challengeId: CHALLENGE(`loop-${i}`),
          nonce: BigInt(1000 + i),
          deadline: (await time.latest()) + 3600,
        };
        const sig = await signAuth(facilitator, agentEOA, auth);
        await facilitator.pay(auth, sig);
      }
      const overflow = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('overflow'),
        nonce: 2000n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, overflow);
      await expect(facilitator.pay(overflow, sig)).to.be.revertedWithCustomError(
        facilitator,
        'PerPeriodExceeded',
      );
    });

    it('lazy window rollover after periodLen elapses', async () => {
      const { facilitator, agentEOA, merchant, addr } = await setup();
      // Spend up to the cap, advance time past the window, then spend again.
      const auth1 = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('10'),
        challengeId: CHALLENGE('w1'),
        nonce: 50n,
        deadline: (await time.latest()) + 3600,
      };
      const sig1 = await signAuth(facilitator, agentEOA, auth1);
      await facilitator.pay(auth1, sig1);

      await time.increase(DAY + 1);

      const auth2 = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('10'),
        challengeId: CHALLENGE('w2'),
        nonce: 51n,
        deadline: (await time.latest()) + 3600,
      };
      const sig2 = await signAuth(facilitator, agentEOA, auth2);
      await facilitator.pay(auth2, sig2);

      const L = await facilitator.getLimit(AGENT_ID, addr);
      // After rollover, spentInPeriod resets to the just-paid amount only.
      expect(L.spentInPeriod).to.equal(ethers.parseEther('10'));
    });

    it('rejects when limit is disabled or never set', async () => {
      const ctx = await deploy();
      const { facilitator, identity, token, agentEOA, otherOwner, merchant } = ctx;
      await identity.register(otherOwner.address, AGENT_ID, agentEOA.address);
      // No setLimit call. Token approval still required to even attempt the pay.
      await token.mint(agentEOA.address, ethers.parseEther('5'));
      await token.connect(agentEOA).approve(await facilitator.getAddress(), ethers.MaxUint256);

      const auth = {
        agentId: AGENT_ID,
        token: await token.getAddress(),
        merchant: merchant.address,
        amount: ethers.parseEther('1'),
        challengeId: CHALLENGE('no-limit'),
        nonce: 1n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, agentEOA, auth);
      await expect(facilitator.pay(auth, sig)).to.be.revertedWithCustomError(
        facilitator,
        'LimitDisabledOrUnset',
      );
    });
  });

  // ---------------------------------------------------------------------
  // ERC-1271 smart wallet flow
  // ---------------------------------------------------------------------

  describe('ERC-1271 signer', () => {
    const AGENT_ID = 1271n;

    it('accepts a signature validated through a contract wallet', async () => {
      const { facilitator, identity, token, otherOwner, merchant } = await deploy();
      const innerSigner = ethers.Wallet.createRandom().connect(ethers.provider);

      const SmartWallet = await ethers.getContractFactory('MockSmartWallet');
      const wallet = await SmartWallet.deploy(innerSigner.address);
      const walletAddr = await wallet.getAddress();

      await identity.register(otherOwner.address, AGENT_ID, walletAddr);

      const addr = await token.getAddress();
      await facilitator
        .connect(otherOwner)
        .setLimit(AGENT_ID, addr, ethers.parseEther('5'), ethers.parseEther('50'), DAY);

      // Fund the wallet and have it approve the Facilitator via its `execute` helper.
      await token.mint(walletAddr, ethers.parseEther('10'));
      const approveCalldata = token.interface.encodeFunctionData('approve', [
        await facilitator.getAddress(),
        ethers.MaxUint256,
      ]);
      await wallet.execute(await token.getAddress(), approveCalldata);

      const auth = {
        agentId: AGENT_ID,
        token: addr,
        merchant: merchant.address,
        amount: ethers.parseEther('2'),
        challengeId: CHALLENGE('1271'),
        nonce: 7n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await signAuth(facilitator, innerSigner, auth);

      await expect(facilitator.pay(auth, sig)).to.emit(facilitator, 'Settled');
      expect(await token.balanceOf(merchant.address)).to.be.gt(0n);
    });
  });

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  describe('setTreasury', () => {
    it('owner can rotate', async () => {
      const { facilitator, owner, attacker, treasury } = await deploy();
      await expect(facilitator.connect(owner).setTreasury(attacker.address))
        .to.emit(facilitator, 'TreasurySet')
        .withArgs(treasury.address, attacker.address);
      expect(await facilitator.treasury()).to.equal(attacker.address);
    });

    it('non-owner rejected', async () => {
      const { facilitator, attacker } = await deploy();
      await expect(facilitator.connect(attacker).setTreasury(attacker.address))
        .to.be.revertedWithCustomError(facilitator, 'OwnableUnauthorizedAccount');
    });

    it('zero address rejected', async () => {
      const { facilitator, owner } = await deploy();
      await expect(facilitator.connect(owner).setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(facilitator, 'InvalidAddress');
    });
  });

  // ---------------------------------------------------------------------
  // paymentAuthHash — sanity check against off-chain typed data hashing
  // ---------------------------------------------------------------------

  describe('paymentAuthHash', () => {
    it('matches ethers.TypedDataEncoder.hash', async () => {
      const { facilitator, token, merchant } = await deploy();
      const auth = {
        agentId: 5n,
        token: await token.getAddress(),
        merchant: merchant.address,
        amount: 123n,
        challengeId: CHALLENGE('hash-check'),
        nonce: 9n,
        deadline: (await time.latest()) + 60,
      };
      const onChain = await facilitator.paymentAuthHash(auth);
      const offChain = ethers.TypedDataEncoder.hash(
        await domain(facilitator),
        PAYMENT_AUTH_TYPES,
        auth,
      );
      expect(onChain).to.equal(offChain);
    });
  });
});
