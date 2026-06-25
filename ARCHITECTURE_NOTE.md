# Architecture note

Two designs in this repo. Required track first, advanced second.

## Required: commit-reveal

Participants submit a hash during the submission window, then reveal
`(answer, salt)` during a separate reveal window. The contract
re-derives the commitment and only counts the answer if it matches.

```
keccak256(abi.encode(bountyId, msg.sender, answer, salt))
```

`bountyId` and `msg.sender` are in the hash for a reason — without them
you can pull someone else's commitment off-chain and reveal it from a
different wallet, or replay the same commitment across two bounties.
With them, the commitment is effectively scoped to one (participant,
bounty) pair.

Strengths: portable to any EVM chain, easy to test, cheap.

Weakness: plaintext lands on-chain during the reveal window, before the
LLM sees it. That's enough to stop copying during submission, but it's
not real end-to-end privacy.

## Advanced: Ritual TEE

Same lifecycle, different storage. Participants encrypt for the TEE's
pubkey, push the ciphertext off-chain, and only post the hash + ref on
chain. The Ritual TEE executor pulls everything after the submission
deadline, decrypts inside the enclave, runs one batched LLM call, and
posts back `(judgmentHash, judgmentRef, invalidatedIndexes)`.

The contract never sees plaintext. Even after judging, only the winner's
answer needs to be revealed if the bounty's policy chooses to publish
it — non-winners can stay encrypted forever.

Trust assumptions:

- The TEE attestation is valid (verified by Ritual; the pubkey hash is
  bound on-chain when the bounty is created).
- The `teeExecutor` address is held inside the enclave for that bounty.
- Off-chain storage stays available (anyone can re-pin a ciphertext or
  the judgment by hash).

The contract still doesn't trust the AI itself. Only the owner can pay,
and the TEE can flag malformed payloads via `invalidatedIndexes` so the
owner can't accidentally select a broken submission as the winner.

## What's public vs hidden

Public on both tracks:

- Bounty metadata (title, rubric, reward, deadlines).
- Commitments or encrypted references.
- The AI review hash / judgment hash and the winner index.

Hidden:

- Plaintext answers, until the reveal phase (required) or until the
  owner chooses to publish them (advanced).
- TEE decryption keys (advanced — only ever inside the enclave).
- RPC/deploy/TEE secrets (in `.env`, gitignored).

## On-chain vs off-chain

| Data                       | Required           | Advanced                     |
|----------------------------|--------------------|------------------------------|
| Bounty metadata             | on-chain           | on-chain                     |
| Commitment / payload hash   | on-chain           | on-chain                     |
| Ciphertext                  | n/a                | off-chain (IPFS / Ritual)    |
| Plaintext answer            | on-chain (reveal)  | inside the TEE only          |
| AI review / judgment        | on-chain string    | on-chain hash + off-chain ref|
| Winner index                | on-chain           | on-chain                     |

## Why batch judging

If you call the LLM once per submission you get a different model context
every time, which makes the scoring drift, and you pay N times for the
same comparison. One prompt with every answer is fairer and cheaper.
`judgeAll` (required) and `postBatchJudgment` (advanced) both encode the
"one batched call" rule.

## Why the owner still finalizes

LLM output can be wrong or ambiguous. The contract treats it as a
recommendation. Payout requires an explicit `finalizeWinner` tx from the
bounty owner, so a bad AI suggestion never moves funds on its own.

## Example judgment payload (advanced)

```json
{
  "bountyId": 0,
  "winnerIndex": 2,
  "ranking": [
    {"index": 2, "score": 94, "reason": "best matches rubric"},
    {"index": 0, "score": 81, "reason": "missed criterion B"},
    {"index": 1, "score": 60, "reason": "off-topic in last paragraph"}
  ],
  "summary": "Submission 2 is the strongest answer for the given rubric."
}
```

The hash of this JSON is `judgmentHash` on-chain. The JSON itself lives
at `judgmentRef` (IPFS or Ritual storage).
