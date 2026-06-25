# Batch judging

The homework is explicit: one LLM call per bounty, not one per submission.
Both tracks honor that.

## Why batch

- Per-call drift: model state shifts between calls, so scoring drifts too.
- Cost: N submissions × N calls is wasteful when one prompt does the job.
- Audit: a single judgment hash anchors the whole comparison.

## Required track — `judgeAll`

```
[revealDeadline passes]
  owner pulls every revealed answer from the contract
  owner builds ONE Ritual AI prompt: rubric + all answers
  owner calls Ritual AI ONCE, gets back a review string
  owner calls judgeAll(bountyId, aiReview)
  owner calls finalizeWinner(bountyId, winnerIndex)
```

The contract doesn't know whether the owner called the LLM once or a
hundred times, but the docs + demo all enforce the one-call rule, and
the review string is hashed and emitted so reviewers can spot suspicious
patterns.

## Advanced track — `postBatchJudgment`

```
[submissionDeadline passes]
  TEE indexes SubmissionPosted events
  for each submission:
    fetch ciphertext via payloadRef
    verify keccak256(ciphertext) == payloadHash
    decrypt inside the enclave
  build ONE prompt: rubric + every decrypted answer + JSON schema
  call the LLM ONCE
  hash the structured judgment -> judgmentHash
  upload the JSON              -> judgmentRef
  TEE signer posts (judgmentHash, judgmentRef, invalidatedIndexes)
[owner reads JSON off-chain, calls finalizeWinner]
```

`invalidatedIndexes` is the TEE's way of saying "this submission was
malformed (couldn't decrypt, didn't parse, etc.) — don't let it win".
The contract enforces that by reverting `finalizeWinner` on an
invalidated index.

## Anti-patterns

- One LLM call per submission. Expensive, unfair, hard to audit.
- Sending plaintext to the LLM provider directly. Defeats the privacy
  point of the advanced track.
- Automatic payout from the AI result. AI hallucinations would turn into
  real money loss.
- Storing full answers on-chain. Gas-prohibitive and removes
  confidentiality.
- Letting anyone call `judgeAll` or `postBatchJudgment`. The
  recommendation would be trivially griefable.
