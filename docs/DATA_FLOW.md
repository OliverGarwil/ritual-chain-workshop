# Data flow (on-chain vs off-chain)

Quick reference for what lives where in each track.

## Required (commit-reveal)

```
submission phase             reveal phase              judge phase
─────────────────            ─────────────             ───────────

participant ──► commitment       ──► reveal(answer,salt)  ──► (owner)

on-chain  : Commitment{hash}         RevealedSubmission       Bounty.aiReview
off-chain : answer + salt (private)  (now public on-chain)    full review text
```

| data                      | location          | when               |
|---------------------------|-------------------|--------------------|
| bounty metadata            | on-chain          | createBounty        |
| commitment hash            | on-chain          | submitCommitment    |
| plaintext answer + salt    | off-chain (user)  | until reveal        |
| revealed plaintext answer  | on-chain          | revealAnswer        |
| AI review (batched)        | on-chain (string) | judgeAll            |
| winner index               | on-chain          | finalizeWinner      |

Privacy boundary: answers are private until the reveal phase opens.

## Advanced (Ritual TEE)

```
submission phase                                judging                finalize
─────────────────                              ─────────              ────────

participant ─► encrypt locally
              upload ciphertext off-chain
              post (payloadHash, payloadRef, commitment) on-chain
                       │
                       ▼
                                              Ritual TEE
                                               fetch + verify hash
                                               decrypt in-enclave
                                               ONE batched LLM call
                                               build judgment JSON
                                               post (judgmentHash, judgmentRef)
                                                                      │
                                                                      ▼
                                                                  bounty owner
                                                                   finalizeWinner
```

| data                          | location                   |
|-------------------------------|----------------------------|
| bounty metadata + TEE config  | on-chain                   |
| ciphertext                    | off-chain (IPFS / Ritual)  |
| payloadHash                   | on-chain                   |
| payloadRef                    | on-chain                   |
| commitment                    | on-chain                   |
| decrypted plaintext           | only inside the TEE        |
| judgmentHash                  | on-chain                   |
| judgmentRef                   | on-chain                   |
| full judgment JSON            | off-chain                  |
| winner index                  | on-chain                   |

Privacy boundary: plaintext is private end-to-end. Only the winner's
answer needs to be revealed afterwards, if the bounty policy chooses to.

## Side by side

| concern                            | required           | advanced                |
|------------------------------------|--------------------|--------------------------|
| plaintext on-chain                  | yes, after reveal  | never                    |
| plaintext leaks before judging      | no                 | no                       |
| plaintext leaks before payout       | yes (all reveals)  | no (selective by policy) |
| chain portability                   | any EVM            | needs Ritual             |
| gas footprint                       | low                | lower (hashes + refs)    |
| extra infra to run                  | none               | TEE pipeline + storage   |
