# Reflection

> What should be public, what should stay hidden, and what should be decided
> by AI vs by a human in a bounty system?

The rules — title, rubric, reward, deadlines, payout state — have to be
public, otherwise nobody can trust the system. Submissions are the
opposite: if they're public during the submission phase you've basically
turned the bounty into "be the last person to submit, and copy". So
submissions have to stay hidden long enough that copying isn't useful.

The required track does that with commit-reveal. I included `bountyId`
and `msg.sender` in the commitment because the first version I tried
didn't, and I realised someone could just copy another person's
commitment hash from the mempool and reveal it from their own wallet. The
fix is small but it took me a while to convince myself it was correct.

The advanced track goes further — the chain never sees plaintext at all,
the TEE handles everything inside an enclave. I didn't fully build the
off-chain TEE pipeline (it's mostly Ritual infra), but the on-chain side
treats the TEE like an oracle with a pre-registered signer, which kept
the contract small.

AI is a good fit for ranking many answers against the same rubric in one
shot — that's what the `judgeAll` / `postBatchJudgment` batch step is
for. What AI shouldn't do is move funds. The owner still has to call
`finalizeWinner`; I'd rather an honest mistake than an automatic payout
to a hallucinated index.

So the split ends up being: chain enforces timing and payout, AI handles
evaluation inside a privacy boundary, human signs off. That's the part
I'd keep if I rebuilt this from scratch.
