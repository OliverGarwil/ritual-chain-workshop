const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PrivacyPreservingBountyJudge", function () {
  const title = "Ritual judge bounty";
  const rubric = "Pick the answer that best explains privacy-preserving AI judging.";
  const answerA = "Use commit-reveal for fairness and batch AI judging after reveal.";
  const answerB = "Use encrypted submissions and TEE execution for stronger privacy.";
  const saltA = ethers.id("salt-a");
  const saltB = ethers.id("salt-b");
  const reward = ethers.parseEther("1");

  async function deployJudge() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Judge = await ethers.getContractFactory("PrivacyPreservingBountyJudge");
    const judge = await Judge.deploy();
    await judge.waitForDeployment();
    return { judge, owner, alice, bob };
  }

  async function createBounty(judge, owner) {
    const now = await time.latest();
    const submissionDeadline = now + 100;
    const revealDeadline = now + 200;
    await judge
      .connect(owner)
      .createBounty(title, rubric, submissionDeadline, revealDeadline, { value: reward });
    return { bountyId: 0, submissionDeadline, revealDeadline };
  }

  async function commitmentFor(judge, bountyId, participant, answer, salt) {
    return judge.computeCommitment(bountyId, participant.address, answer, salt);
  }

  it("creates a funded bounty and rejects invalid deadlines or reward", async function () {
    const { judge, owner } = await deployJudge();
    const now = await time.latest();

    await expect(
      judge.connect(owner).createBounty(title, rubric, now + 100, now + 200, { value: reward })
    )
      .to.emit(judge, "BountyCreated")
      .withArgs(0, owner.address, reward, now + 100, now + 200);

    await expect(judge.connect(owner).createBounty(title, rubric, now + 100, now + 200)).to.be.revertedWith(
      "Reward required"
    );

    await expect(
      judge.connect(owner).createBounty(title, rubric, now + 200, now + 100, { value: reward })
    ).to.be.revertedWith("Reveal deadline must be later");
  });

  it("accepts one hidden commitment before the submission deadline", async function () {
    const { judge, owner, alice } = await deployJudge();
    const { bountyId } = await createBounty(judge, owner);
    const commitment = await commitmentFor(judge, bountyId, alice, answerA, saltA);

    await expect(judge.connect(alice).submitCommitment(bountyId, commitment))
      .to.emit(judge, "CommitmentSubmitted")
      .withArgs(bountyId, alice.address, commitment);

    const saved = await judge.getCommitment(bountyId, alice.address);
    expect(saved.commitment).to.equal(commitment);
    expect(saved.exists).to.equal(true);
    expect(saved.revealed).to.equal(false);

    const bounty = await judge.getBounty(bountyId);
    expect(bounty.revealedCount).to.equal(0);
  });

  it("rejects empty, late, duplicate, and missing-bounty commitments", async function () {
    const { judge, owner, alice } = await deployJudge();
    const { bountyId } = await createBounty(judge, owner);
    const commitment = await commitmentFor(judge, bountyId, alice, answerA, saltA);

    await expect(judge.connect(alice).submitCommitment(bountyId, ethers.ZeroHash)).to.be.revertedWith(
      "Empty commitment"
    );

    await judge.connect(alice).submitCommitment(bountyId, commitment);
    await expect(judge.connect(alice).submitCommitment(bountyId, commitment)).to.be.revertedWith(
      "Already committed"
    );

    await expect(judge.connect(alice).submitCommitment(99, commitment)).to.be.revertedWith("Bounty does not exist");

    const { judge: lateJudge, owner: lateOwner, alice: lateAlice } = await deployJudge();
    const created = await createBounty(lateJudge, lateOwner);
    const lateCommitment = await commitmentFor(lateJudge, created.bountyId, lateAlice, answerA, saltA);
    await time.increaseTo(created.submissionDeadline);
    await expect(lateJudge.connect(lateAlice).submitCommitment(created.bountyId, lateCommitment)).to.be.revertedWith(
      "Submission phase closed"
    );
  });

  it("reveals only the original answer and salt from the original committer", async function () {
    const { judge, owner, alice, bob } = await deployJudge();
    const { bountyId, submissionDeadline } = await createBounty(judge, owner);
    const commitment = await commitmentFor(judge, bountyId, alice, answerA, saltA);
    await judge.connect(alice).submitCommitment(bountyId, commitment);

    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith(
      "Reveal phase not started"
    );

    await time.increaseTo(submissionDeadline);

    await expect(judge.connect(bob).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith("No commitment");
    await expect(judge.connect(alice).revealAnswer(bountyId, "edited answer", saltA)).to.be.revertedWith(
      "Invalid reveal"
    );
    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltB)).to.be.revertedWith("Invalid reveal");

    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltA))
      .to.emit(judge, "AnswerRevealed")
      .withArgs(bountyId, alice.address, 0);

    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith("Already revealed");

    const revealed = await judge.getRevealedSubmission(bountyId, 0);
    expect(revealed.participant).to.equal(alice.address);
    expect(revealed.answer).to.equal(answerA);
  });

  it("binds commitments to the bounty id and committing wallet", async function () {
    const { judge, owner, alice, bob } = await deployJudge();
    const { bountyId, submissionDeadline } = await createBounty(judge, owner);

    const copiedCommitment = await commitmentFor(judge, bountyId, alice, answerA, saltA);
    await judge.connect(bob).submitCommitment(bountyId, copiedCommitment);

    const wrongBountyCommitment = await commitmentFor(judge, 1, alice, answerA, saltA);
    await judge.connect(alice).submitCommitment(bountyId, wrongBountyCommitment);

    await time.increaseTo(submissionDeadline);

    await expect(judge.connect(bob).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith("Invalid reveal");
    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith("Invalid reveal");
  });

  it("rejects reveals after the reveal deadline", async function () {
    const { judge, owner, alice } = await deployJudge();
    const { bountyId, revealDeadline } = await createBounty(judge, owner);
    const commitment = await commitmentFor(judge, bountyId, alice, answerA, saltA);
    await judge.connect(alice).submitCommitment(bountyId, commitment);

    await time.increaseTo(revealDeadline);
    await expect(judge.connect(alice).revealAnswer(bountyId, answerA, saltA)).to.be.revertedWith(
      "Reveal phase closed"
    );
  });

  it("judges only after reveal deadline, only once, and only with valid revealed answers", async function () {
    const { judge, owner, alice, bob } = await deployJudge();
    const { bountyId, submissionDeadline, revealDeadline } = await createBounty(judge, owner);

    await judge.connect(alice).submitCommitment(bountyId, await commitmentFor(judge, bountyId, alice, answerA, saltA));
    await judge.connect(bob).submitCommitment(bountyId, await commitmentFor(judge, bountyId, bob, answerB, saltB));

    await time.increaseTo(submissionDeadline);
    await judge.connect(alice).revealAnswer(bountyId, answerA, saltA);

    await expect(judge.connect(owner).judgeAll(bountyId, "Winner recommendation: index 0")).to.be.revertedWith(
      "Reveal phase still open"
    );

    await time.increaseTo(revealDeadline);
    await expect(judge.connect(bob).judgeAll(bountyId, "Winner recommendation: index 0")).to.be.revertedWith(
      "Only bounty owner"
    );
    await expect(judge.connect(owner).judgeAll(bountyId, "")).to.be.revertedWith("Empty AI review");

    await expect(judge.connect(owner).judgeAll(bountyId, "Winner recommendation: index 0"))
      .to.emit(judge, "BountyJudged")
      .withArgs(bountyId, 1, ethers.keccak256(ethers.toUtf8Bytes("Winner recommendation: index 0")));

    await expect(judge.connect(owner).judgeAll(bountyId, "Second review")).to.be.revertedWith("Already judged");

    const bounty = await judge.getBounty(bountyId);
    expect(bounty.judged).to.equal(true);
    expect(bounty.aiReview).to.equal("Winner recommendation: index 0");
    expect(bounty.revealedCount).to.equal(1);
  });

  it("rejects judging when no valid answers were revealed and allows owner recovery", async function () {
    const { judge, owner, alice } = await deployJudge();
    const { bountyId, revealDeadline } = await createBounty(judge, owner);
    await judge.connect(alice).submitCommitment(bountyId, await commitmentFor(judge, bountyId, alice, answerA, saltA));

    await time.increaseTo(revealDeadline);
    await expect(judge.connect(owner).judgeAll(bountyId, "No answers")).to.be.revertedWith("No valid reveals");
    await expect(() => judge.connect(owner).refundIfNoValidReveals(bountyId)).to.changeEtherBalances(
      [judge, owner],
      [-reward, reward]
    );

    const bounty = await judge.getBounty(bountyId);
    expect(bounty.refunded).to.equal(true);
  });

  it("finalizes one winner after judging and pays the reward once", async function () {
    const { judge, owner, alice, bob } = await deployJudge();
    const { bountyId, submissionDeadline, revealDeadline } = await createBounty(judge, owner);

    await judge.connect(alice).submitCommitment(bountyId, await commitmentFor(judge, bountyId, alice, answerA, saltA));
    await judge.connect(bob).submitCommitment(bountyId, await commitmentFor(judge, bountyId, bob, answerB, saltB));

    await time.increaseTo(submissionDeadline);
    await judge.connect(alice).revealAnswer(bountyId, answerA, saltA);
    await judge.connect(bob).revealAnswer(bountyId, answerB, saltB);

    await expect(judge.connect(owner).finalizeWinner(bountyId, 0)).to.be.revertedWith("Not judged");

    await time.increaseTo(revealDeadline);
    await judge.connect(owner).judgeAll(bountyId, "Winner recommendation: index 1");

    await expect(judge.connect(alice).finalizeWinner(bountyId, 1)).to.be.revertedWith("Only bounty owner");
    await expect(judge.connect(owner).finalizeWinner(bountyId, 2)).to.be.revertedWith("Invalid winner index");

    await expect(() => judge.connect(owner).finalizeWinner(bountyId, 1)).to.changeEtherBalances(
      [judge, bob],
      [-reward, reward]
    );

    await expect(judge.connect(owner).finalizeWinner(bountyId, 1)).to.be.revertedWith("Already finalized");

    const bounty = await judge.getBounty(bountyId);
    expect(bounty.finalized).to.equal(true);
    expect(bounty.winnerIndex).to.equal(1);
    expect(bounty.reward).to.equal(0);
  });
});
