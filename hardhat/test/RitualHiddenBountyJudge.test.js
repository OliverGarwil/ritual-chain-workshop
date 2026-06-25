const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Tests for the advanced track contract.
// The submitted "ciphertext" here is a stub — in production participants would
// encrypt for the TEE's pubkey. For the test we only need keccak(blob) to match.

describe("RitualHiddenBountyJudge", function () {
  const TITLE = "TEE-judged bounty";
  const RUBRIC = "Best matches the rubric wins.";
  const REWARD = ethers.parseEther("1");
  const TEE_PUBKEY_HASH = ethers.id("ritual-tee-pubkey-v1");

  async function deploy() {
    const [owner, alice, bob, tee, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory("RitualHiddenBountyJudge");
    const c = await F.deploy();
    await c.waitForDeployment();
    return { c, owner, alice, bob, tee, stranger };
  }

  async function createBounty(c, owner, tee) {
    const now = await time.latest();
    const submissionDeadline = now + 100;
    const judgingDeadline = now + 300;
    await c
      .connect(owner)
      .createBounty(TITLE, RUBRIC, submissionDeadline, judgingDeadline, tee.address, TEE_PUBKEY_HASH, {
        value: REWARD,
      });
    return { bountyId: 0, submissionDeadline, judgingDeadline };
  }

  function fakePayload(text) {
    const ciphertext = ethers.toUtf8Bytes("ENC(" + text + ")");
    return {
      payloadHash: ethers.keccak256(ciphertext),
      payloadRef: "ipfs://stub-cid-" + text,
    };
  }

  it("creates a funded bounty and rejects bad params", async function () {
    const { c, owner, tee } = await deploy();
    const now = await time.latest();

    await expect(
      c.connect(owner).createBounty(TITLE, RUBRIC, now + 100, now + 200, tee.address, TEE_PUBKEY_HASH, {
        value: REWARD,
      })
    ).to.emit(c, "BountyCreated");

    await expect(
      c.connect(owner).createBounty(TITLE, RUBRIC, now + 100, now + 200, tee.address, TEE_PUBKEY_HASH)
    ).to.be.revertedWith("reward required");

    await expect(
      c.connect(owner).createBounty(TITLE, RUBRIC, now + 200, now + 100, tee.address, TEE_PUBKEY_HASH, {
        value: REWARD,
      })
    ).to.be.revertedWith("judging deadline too early");

    await expect(
      c.connect(owner).createBounty(TITLE, RUBRIC, now + 100, now + 200, ethers.ZeroAddress, TEE_PUBKEY_HASH, {
        value: REWARD,
      })
    ).to.be.revertedWith("tee executor required");

    await expect(
      c.connect(owner).createBounty(TITLE, RUBRIC, now + 100, now + 200, tee.address, ethers.ZeroHash, {
        value: REWARD,
      })
    ).to.be.revertedWith("tee pubkey hash required");
  });

  it("stores only the encrypted ref + hash, never plaintext", async function () {
    const { c, owner, alice, tee } = await deploy();
    const { bountyId } = await createBounty(c, owner, tee);
    const { payloadHash, payloadRef } = fakePayload("answer-A");
    const commitment = await c.computeCommitment(bountyId, alice.address, payloadHash);

    await expect(c.connect(alice).submitEncrypted(bountyId, payloadHash, payloadRef, commitment))
      .to.emit(c, "SubmissionPosted")
      .withArgs(bountyId, alice.address, 0, commitment, payloadHash, payloadRef);

    const s = await c.getSubmission(bountyId, 0);
    expect(s.participant).to.equal(alice.address);
    expect(s.payloadHash).to.equal(payloadHash);
    expect(s.payloadRef).to.equal(payloadRef);
    expect(s.invalidated).to.equal(false);
  });

  it("rejects bad submissions (dup / late / mismatch / empty)", async function () {
    const { c, owner, alice, bob, tee } = await deploy();
    const { bountyId, submissionDeadline } = await createBounty(c, owner, tee);
    const { payloadHash, payloadRef } = fakePayload("answer-A");
    const aliceCommit = await c.computeCommitment(bountyId, alice.address, payloadHash);

    await expect(
      c.connect(alice).submitEncrypted(bountyId, ethers.ZeroHash, payloadRef, aliceCommit)
    ).to.be.revertedWith("empty payload hash");
    await expect(
      c.connect(alice).submitEncrypted(bountyId, payloadHash, "", aliceCommit)
    ).to.be.revertedWith("empty payload ref");

    // bob tries to use alice's commitment from his own wallet
    await expect(
      c.connect(bob).submitEncrypted(bountyId, payloadHash, payloadRef, aliceCommit)
    ).to.be.revertedWith("bad commitment");

    await c.connect(alice).submitEncrypted(bountyId, payloadHash, payloadRef, aliceCommit);
    await expect(
      c.connect(alice).submitEncrypted(bountyId, payloadHash, payloadRef, aliceCommit)
    ).to.be.revertedWith("already submitted");

    await time.increaseTo(submissionDeadline);
    const bobP = fakePayload("answer-B");
    const bobCommit = await c.computeCommitment(bountyId, bob.address, bobP.payloadHash);
    await expect(
      c.connect(bob).submitEncrypted(bountyId, bobP.payloadHash, bobP.payloadRef, bobCommit)
    ).to.be.revertedWith("submission closed");
  });

  it("only the TEE can post the batch judgment, and only inside the window", async function () {
    const { c, owner, alice, bob, tee, stranger } = await deploy();
    const { bountyId, submissionDeadline, judgingDeadline } = await createBounty(c, owner, tee);

    const a = fakePayload("answer-A");
    const b = fakePayload("answer-B");
    const aC = await c.computeCommitment(bountyId, alice.address, a.payloadHash);
    const bC = await c.computeCommitment(bountyId, bob.address, b.payloadHash);
    await c.connect(alice).submitEncrypted(bountyId, a.payloadHash, a.payloadRef, aC);
    await c.connect(bob).submitEncrypted(bountyId, b.payloadHash, b.payloadRef, bC);

    const jHash = ethers.id("batch-judgment-1");
    const jRef = "ipfs://judgment-cid";

    await expect(
      c.connect(tee).postBatchJudgment(bountyId, jHash, jRef, [])
    ).to.be.revertedWith("submission still open");

    await time.increaseTo(submissionDeadline);

    await expect(
      c.connect(stranger).postBatchJudgment(bountyId, jHash, jRef, [])
    ).to.be.revertedWith("not tee");
    await expect(
      c.connect(tee).postBatchJudgment(bountyId, ethers.ZeroHash, jRef, [])
    ).to.be.revertedWith("empty judgment hash");
    await expect(
      c.connect(tee).postBatchJudgment(bountyId, jHash, "", [])
    ).to.be.revertedWith("empty judgment ref");

    await expect(c.connect(tee).postBatchJudgment(bountyId, jHash, jRef, []))
      .to.emit(c, "BatchJudged")
      .withArgs(bountyId, jHash, jRef, 2);

    await expect(
      c.connect(tee).postBatchJudgment(bountyId, jHash, jRef, [])
    ).to.be.revertedWith("already judged");

    // late post should fail in a fresh bounty
    await time.increaseTo(judgingDeadline);
    const fresh = await deploy();
    const created = await createBounty(fresh.c, fresh.owner, fresh.tee);
    const lp = fakePayload("late");
    const lc = await fresh.c.computeCommitment(created.bountyId, fresh.alice.address, lp.payloadHash);
    await fresh.c.connect(fresh.alice).submitEncrypted(created.bountyId, lp.payloadHash, lp.payloadRef, lc);
    await time.increaseTo(created.judgingDeadline);
    await expect(
      fresh.c.connect(fresh.tee).postBatchJudgment(created.bountyId, jHash, jRef, [])
    ).to.be.revertedWith("judging window closed");
  });

  it("TEE can invalidate malformed submissions, owner can't pay them", async function () {
    const { c, owner, alice, bob, tee } = await deploy();
    const { bountyId, submissionDeadline } = await createBounty(c, owner, tee);

    const a = fakePayload("answer-A");
    const b = fakePayload("answer-B-malformed");
    const aC = await c.computeCommitment(bountyId, alice.address, a.payloadHash);
    const bC = await c.computeCommitment(bountyId, bob.address, b.payloadHash);
    await c.connect(alice).submitEncrypted(bountyId, a.payloadHash, a.payloadRef, aC);
    await c.connect(bob).submitEncrypted(bountyId, b.payloadHash, b.payloadRef, bC);

    await time.increaseTo(submissionDeadline);
    const jHash = ethers.id("batch-judgment-2");

    await expect(c.connect(tee).postBatchJudgment(bountyId, jHash, "ipfs://j", [1]))
      .to.emit(c, "SubmissionInvalidatedByTEE")
      .withArgs(bountyId, 1);

    await expect(c.connect(owner).finalizeWinner(bountyId, 1)).to.be.revertedWith("winner invalidated");

    await expect(() => c.connect(owner).finalizeWinner(bountyId, 0)).to.changeEtherBalances(
      [c, alice],
      [-REWARD, REWARD]
    );
  });

  it("finalize: needs judging, only owner, pays once", async function () {
    const { c, owner, alice, bob, tee } = await deploy();
    const { bountyId, submissionDeadline } = await createBounty(c, owner, tee);

    const a = fakePayload("answer-A");
    const aC = await c.computeCommitment(bountyId, alice.address, a.payloadHash);
    await c.connect(alice).submitEncrypted(bountyId, a.payloadHash, a.payloadRef, aC);

    await expect(c.connect(owner).finalizeWinner(bountyId, 0)).to.be.revertedWith("not judged");

    await time.increaseTo(submissionDeadline);
    await c.connect(tee).postBatchJudgment(bountyId, ethers.id("ok"), "ipfs://j", []);

    await expect(c.connect(bob).finalizeWinner(bountyId, 0)).to.be.revertedWith("not owner");
    await expect(c.connect(owner).finalizeWinner(bountyId, 99)).to.be.revertedWith("bad winner index");

    await expect(() => c.connect(owner).finalizeWinner(bountyId, 0)).to.changeEtherBalances(
      [c, alice],
      [-REWARD, REWARD]
    );

    await expect(c.connect(owner).finalizeWinner(bountyId, 0)).to.be.revertedWith("already finalized");
  });

  it("owner can refund if the TEE never shows up", async function () {
    const { c, owner, alice, tee } = await deploy();
    const { bountyId, judgingDeadline } = await createBounty(c, owner, tee);

    const a = fakePayload("answer-A");
    const aC = await c.computeCommitment(bountyId, alice.address, a.payloadHash);
    await c.connect(alice).submitEncrypted(bountyId, a.payloadHash, a.payloadRef, aC);

    await expect(c.connect(owner).refundIfNotJudged(bountyId)).to.be.revertedWith("judging still open");

    await time.increaseTo(judgingDeadline);
    await expect(() => c.connect(owner).refundIfNotJudged(bountyId)).to.changeEtherBalances(
      [c, owner],
      [-REWARD, REWARD]
    );
  });
});
