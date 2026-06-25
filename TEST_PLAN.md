# Test plan

Automated tests live in `test/`. Run everything with:

```bash
npx hardhat test
```

## Required track — `PrivacyPreservingBountyJudge`

9 tests, covering:

1. Bounty creation rejects zero reward and bad deadlines.
2. A participant can submit one commitment before the submission deadline.
3. Empty, late, duplicate, and missing-bounty commitments revert.
4. Reveal accepts only the original answer + salt from the original wallet.
5. A commitment can't be reused across wallets or bounty ids.
6. Reveal after `revealDeadline` reverts.
7. `judgeAll` is owner-only, runs once, and only after the reveal deadline.
8. Owner can refund if nobody revealed anything valid.
9. `finalizeWinner` pays the winner exactly once.

Reveal cases I specifically wanted covered:

| input                                  | expected      |
|----------------------------------------|---------------|
| right answer + right salt + right wallet | accept       |
| wrong answer                           | revert        |
| wrong salt                             | revert        |
| no commitment from this wallet         | revert        |
| copied commitment, different wallet    | revert        |
| commitment created with a different bountyId | revert  |
| reveal before submission deadline       | revert        |
| reveal after reveal deadline            | revert        |
| double reveal                           | revert        |

## Advanced track — `RitualHiddenBountyJudge`

7 tests, covering:

1. Bounty creation rejects zero reward, bad deadlines, zero TEE address,
   and zero TEE pubkey hash.
2. Submission stores only `(payloadHash, payloadRef, commitment)`. No
   plaintext ever lands in storage.
3. Empty, duplicate, late, and wrong-commitment submissions revert.
4. `postBatchJudgment` is TEE-only, only inside the judging window, only
   once, with non-empty hash + ref.
5. TEE can flag malformed payloads; the owner can't pick them as winners.
6. `finalizeWinner` requires judging first, owner-only, pays once.
7. `refundIfNotJudged` returns the reward if the TEE never shows up.

Privacy checks:

- No `string answer` field anywhere in storage (code review + test 2).
- Commitment is scoped to (bountyId, sender, payloadHash) — copying it
  across wallets or bounties just fails the `bad commitment` check.
- Stranger can't impersonate the TEE → `not tee`.
- Stranger can't finalize → `not owner`.
- Invalidated submissions can't be paid → `winner invalidated`.
- Reward can't be paid twice → `already finalized`.

## Manual walkthrough

`DEMO_GUIDE.md` has the 8-step demo if you want to see this end-to-end
instead of relying on the test output.
