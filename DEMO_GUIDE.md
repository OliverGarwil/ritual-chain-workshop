# Demo guide

A short walkthrough for reviewers. The required track is the one I'd actually
demo end-to-end on Ritual testnet; the advanced track is best shown via the
tests since the TEE pipeline is off-chain.

## Required track

1. **Create a bounty.** Call `createBounty(title, rubric, submissionDeadline,
   revealDeadline)` with some ETH attached. The reward gets locked in the
   contract.

2. **Submit commitments.** Two or three wallets each compute
   `keccak256(abi.encode(bountyId, msg.sender, answer, salt))` locally and
   call `submitCommitment(bountyId, commitment)`. The plaintext answer
   never leaves the participant's machine yet.

3. **Try a bad reveal.** Fast-forward past the submission deadline and have
   one wallet call `revealAnswer` with the wrong salt. It should revert
   with `Invalid reveal`. Same with a different wallet trying to reveal
   someone else's commitment.

4. **Reveal correctly.** Same wallet, correct `(answer, salt)` →
   `AnswerRevealed` event.

5. **Show what's eligible.** Anyone whose commitment never got revealed
   is silently excluded from judging. Only the revealed answers count.

6. **Batch judge.** After the reveal deadline, the owner calls
   `judgeAll(bountyId, aiReview)` once. In a real demo the `aiReview`
   string would come from a single Ritual AI prompt covering every
   revealed answer.

7. **Finalize.** Owner calls `finalizeWinner(bountyId, winnerIndex)`.
   The winner gets paid.

8. **Try to finalize again.** Should revert (`Already finalized`).
   Reward can only be paid once.

## Advanced track

The tests in `test/RitualHiddenBountyJudge.test.js` cover the same flow
but with encrypted submissions. The off-chain pieces (TEE pulling
ciphertexts, decrypting in-enclave, calling the LLM once, posting the
judgment hash) are described in `docs/TEE_DESIGN.md`. The contract
itself just anchors hashes and routes the payout.

## What to watch for

- Plaintext answers are never stored during the submission phase.
- A wrong reveal fails.
- Commitments include `bountyId` and the participant's wallet, so they
  can't be reused.
- Only the owner can call `judgeAll` / `postBatchJudgment` (advanced).
- The AI review is treated as advice. The owner picks the winner.
