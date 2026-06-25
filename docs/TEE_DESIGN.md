# TEE design notes (advanced track)

These are the notes I worked from while writing `RitualHiddenBountyJudge.sol`.
They cover the three things the homework explicitly asks about:

1. Where plaintext answers exist.
2. What's on-chain vs off-chain.
3. How the LLM receives submissions for batch judging.

## Components

- **Participant CLI (off-chain).** Encrypts the answer with the TEE pubkey,
  uploads the ciphertext to IPFS or Ritual storage, computes
  `payloadHash = keccak256(ciphertext)` and
  `commitment = keccak256(abi.encode(bountyId, sender, payloadHash))`,
  and calls `submitEncrypted(bountyId, payloadHash, payloadRef, commitment)`.
  The plaintext never leaves the user's machine.

- **Smart contract.** Stores bounty metadata, the per-submission
  `(payloadHash, payloadRef, commitment, invalidated)` tuple, and the
  judgment hash + ref after the TEE posts back. It does not store
  plaintext, decrypted text, or any decryption material.

- **Ritual TEE executor (off-chain).** Indexes `SubmissionPosted` events,
  fetches each ciphertext via `payloadRef`, verifies
  `keccak256(ciphertext) == payloadHash`, decrypts inside the enclave,
  builds one batched prompt for the LLM, hashes the structured judgment
  it gets back, uploads the JSON, and posts `(judgmentHash, judgmentRef,
  invalidatedIndexes)` back to the chain. The signer key for that tx is
  the `teeExecutor` address registered when the bounty was created.

- **Bounty owner.** Reads the judgment off-chain, calls
  `finalizeWinner(bountyId, winnerIndex)`. The contract pays.

## Where plaintext exists at each step

| Step                             | Plaintext location                       |
|----------------------------------|-------------------------------------------|
| Before submission                | Only on the participant's machine         |
| During submission                | Ciphertext only; chain has hash + ref     |
| Between deadlines                | Ciphertext only                           |
| Inside `postBatchJudgment`       | Only inside the TEE enclave               |
| After finalization               | Optionally published off-chain by policy  |

The contract never has access to a plaintext field. The LLM provider
sees plaintext only because the TEE feeds it the prompt, and only for
the duration of that single batched call.

## On-chain vs off-chain

On-chain (small, cheap, verifiable):

- Bounty config (title, rubric, reward, deadlines, TEE addr, TEE pubkey hash).
- Per submission: commitment, payloadHash, payloadRef, invalidated flag.
- Per bounty after judging: judgmentHash, judgmentRef.
- Winner index + payout state.

Off-chain (large, encrypted, content-addressed):

- The ciphertext blobs (IPFS / Ritual storage).
- The full structured judgment JSON.
- Anything the owner chooses to publish about non-winning answers.

The contract stores hashes so anyone can verify the off-chain data
hasn't been swapped under their feet.

## How the LLM sees the batch

Inside the TEE, after decryption, the prompt looks roughly like:

```
SYSTEM
You are judging bounty <bountyId>.
Rubric:
<rubric>

USER
Compare the following submissions and recommend a winner.
Use the rubric strictly. Return JSON:
  { winnerIndex, ranking: [{index, score, reason}], summary }

Submissions:
[0] <plaintext answer 0>
[1] <plaintext answer 1>
[2] <plaintext answer 2>
...
```

One call per bounty, not one call per submission. Every answer is judged
in the same model context against the same rubric, which is cheaper and
fairer than per-answer calls.

The TEE then:

1. Computes `judgmentHash = keccak256(judgmentJson)`.
2. Uploads the JSON, gets back `judgmentRef`.
3. Calls `postBatchJudgment(bountyId, judgmentHash, judgmentRef,
   invalidatedIndexes)`.
4. Anyone can fetch the JSON and verify `keccak256(json) == judgmentHash`.

## Trust assumptions

- The TEE attestation is valid. (Ritual handles this; we just bind the
  pubkey hash on-chain at bounty creation time.)
- The `teeExecutor` private key lives inside the enclave for that
  bounty. It isn't reused across bounties.
- Off-chain storage stays reachable. Anyone can re-pin a ciphertext or
  the judgment JSON because everything is content-addressed.
- The bounty owner is honest enough not to actively grief their own
  bounty. (If they are, the worst case is no winner gets paid — the
  reward sits in the contract or gets refunded via
  `refundIfNotJudged`.)

## What I deliberately didn't do

- No automatic payout from `postBatchJudgment`. The AI recommends, the
  human pays.
- No plaintext on-chain "for convenience". If it's not encrypted, it's
  not in this contract.
- No per-submission LLM call. The batch step is the whole point.
